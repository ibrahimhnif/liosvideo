use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};

use crate::acp::session::{Session, SessionEvents};
use crate::agents;
use crate::cli::{
    AgentCommand, AssetCommand, ConversationCommand, HistoryCommand, KeyCommand, McpCommand,
    ProjectCommand, TtsCommand,
};
use crate::mcp::headless_tools::{self, EditorSession};
use crate::mcp::protocol::handle_mcp_message;
use crate::mcp::tools::ToolRegistry;
use crate::mcp::McpServer;
use crate::project::keychain::Keychain;
use crate::project::{self, export, git, recent, scaffold, scene_validator};
use crate::tts::{TtsProvider, UnifiedTtsProvider};

fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("liosvideo")
}

fn agents_settings_path() -> PathBuf {
    config_dir().join("agents.json")
}

fn adapters_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("liosvideo")
        .join("adapters")
}

fn recent_file() -> PathBuf {
    config_dir().join("recent.json")
}

pub fn project_root(path: &Path) -> Result<PathBuf> {
    path.canonicalize()
        .with_context(|| format!("project folder not found: {}", path.display()))
}

pub async fn run_validate(project: &Path, path: Option<String>, json_out: bool) -> Result<()> {
    let root = project_root(project)?;
    let results = scene_validator::validate_scenes_in_project(&root, path.as_deref());

    if json_out {
        println!("{}", serde_json::to_string_pretty(&results)?);
    } else if results.is_empty() {
        println!(
            "No scene files found under {}",
            root.join("scenes").display()
        );
    } else {
        for result in &results {
            let status = if result.valid { "ok" } else { "FAIL" };
            println!("[{status}] {}", result.file);
            for issue in &result.issues {
                let line = issue.line.map(|l| format!(":{l}")).unwrap_or_default();
                println!("  {}{} {}", issue.severity, line, issue.message);
            }
        }
    }

    if results.iter().any(|r| !r.valid) {
        anyhow::bail!("scene validation failed");
    }
    Ok(())
}

pub async fn run_history(project: &Path, command: HistoryCommand) -> Result<()> {
    let root = project_root(project)?;
    match command {
        HistoryCommand::Status => {
            let status = git::history_status(&root);
            println!("{}", serde_json::to_string_pretty(&status)?);
        }
        HistoryCommand::Enable => {
            let r = root.clone();
            let commit = project::git_job(move || git::enable_history(&r)).await?;
            println!("{}", serde_json::to_string_pretty(&commit)?);
        }
        HistoryCommand::Log { limit } => {
            let r = root.clone();
            let commits = project::git_job(move || git::history(&r, limit)).await?;
            for commit in commits {
                println!("{} {} {}", commit.short_id, commit.time, commit.summary);
            }
        }
        HistoryCommand::Diff { commit } => {
            let r = root.clone();
            let diffs = project::git_job(move || git::commit_diff(&r, &commit)).await?;
            for diff in diffs {
                println!("--- {} ({})", diff.path, diff.status);
                if !diff.binary && !diff.patch.is_empty() {
                    println!("{}", diff.patch);
                }
            }
        }
        HistoryCommand::Checkpoint { message } => {
            let r = root.clone();
            let commit = project::git_job(move || git::commit_all(&r, &message)).await?;
            match commit {
                Some(commit) => println!("{} {}", commit.short_id, commit.summary),
                None => println!("No changes to commit"),
            }
        }
        HistoryCommand::Restore { commit } => {
            let r = root.clone();
            let result = project::git_job(move || git::restore(&r, &commit)).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        HistoryCommand::RevertFiles { commit, paths } => {
            let r = root.clone();
            let result = project::git_job(move || git::revert_files(&r, &commit, &paths)).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}

pub async fn run_project(project: &Path, command: ProjectCommand) -> Result<()> {
    match command {
        ProjectCommand::New {
            parent,
            name,
            template,
        } => {
            let path = scaffold::create_project_in(&parent, &name, template.as_deref())
                .map_err(|e| anyhow!(e.to_string()))?;
            println!("{}", path.display());
        }
        ProjectCommand::Info => {
            let root = project_root(project)?;
            let (root, status, commit) =
                project::prepare_open(&root).map_err(|e| anyhow!(e.to_string()))?;
            let compositions = project::list_compositions_in(&root).unwrap_or_default();
            let files = project::list_code_files_in(&root).unwrap_or_default();
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "root": root.to_string_lossy(),
                    "history": status,
                    "commit": commit,
                    "compositions": compositions,
                    "codeFiles": files,
                }))?
            );
        }
        ProjectCommand::Recent { limit } => {
            let list = recent::load_recent(&recent_file());
            for path in list.into_iter().take(limit) {
                println!("{path}");
            }
        }
        ProjectCommand::Stats { json: as_json } => {
            let root = project_root(project)?;
            let stats = project::load_stats_in(&root);
            if as_json {
                println!("{}", serde_json::to_string_pretty(&stats)?);
            } else {
                println!(
                    "TTS: {} chars, ${:.5}",
                    stats.tts.total_characters, stats.tts.total_cost_usd
                );
                println!(
                    "Tokens: {} in / {} out (${:.5})",
                    stats.tokens.input_tokens,
                    stats.tokens.output_tokens,
                    stats.tokens.total_cost_usd
                );
                println!("Total: ${:.5}", stats.total_cost_usd);
            }
        }
        ProjectCommand::TokenUsage {
            input,
            output,
            model,
        } => {
            let root = project_root(project)?;
            let stats = project::record_token_usage_in(&root, input, output, model.as_deref())
                .map_err(|e| anyhow!(e.to_string()))?;
            println!("{}", serde_json::to_string_pretty(&stats)?);
        }
        ProjectCommand::Conversation { command } => {
            let root = project_root(project)?;
            match command {
                ConversationCommand::Get => match project::load_conversation_in(&root)
                    .map_err(|e| anyhow!(e.to_string()))?
                {
                    Some(content) => println!("{content}"),
                    None => println!("null"),
                },
                ConversationCommand::Set { file } => {
                    let content = std::fs::read_to_string(&file)
                        .with_context(|| format!("failed to read {}", file.display()))?;
                    project::save_conversation_in(&root, &content)
                        .map_err(|e| anyhow!(e.to_string()))?;
                    println!("saved {}", project::conversation_file(&root).display());
                }
            }
        }
    }
    Ok(())
}

pub async fn run_tts(project: &Path, command: TtsCommand) -> Result<()> {
    let root = project_root(project)?;
    match command {
        TtsCommand::Voices => {
            let provider = UnifiedTtsProvider::new();
            for voice in provider.list_voices() {
                println!(
                    "{}\t{}\t{}\t{}",
                    voice.id,
                    voice.name,
                    voice.language,
                    voice.gender.unwrap_or_default()
                );
            }
        }
        TtsCommand::Generate {
            line_id,
            text,
            voice,
        } => {
            let provider = UnifiedTtsProvider::new();
            let result = provider
                .generate(&line_id, &text, voice.as_deref(), &root)
                .await
                .map_err(|e| anyhow!(e))?;
            let label = headless_tools::provider_label(voice.as_deref());
            let stats = project::record_tts_usage_in(
                &root,
                &line_id,
                label,
                voice.as_deref().unwrap_or(""),
                &text,
            )
            .ok()
            .and_then(|s| serde_json::to_value(s).ok());
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "line_id": result.line_id,
                    "audio_path": result.audio_rel_path,
                    "timing_path": result.timing_rel_path,
                    "duration": result.duration,
                    "words": result.words,
                    "stats": stats,
                }))?
            );
        }
        TtsCommand::Timings => {
            let timings = project::get_vo_timings_in(&root);
            println!("{}", serde_json::to_string_pretty(&timings)?);
        }
    }
    Ok(())
}

pub async fn run_asset(project: &Path, command: AssetCommand) -> Result<()> {
    let root = project_root(project)?;
    match command {
        AssetCommand::Import { id, source } => {
            let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("bin");
            let filename = if id.ends_with(&format!(".{ext}")) {
                id.clone()
            } else {
                format!("{id}.{ext}")
            };
            let rel = format!("assets/{filename}");
            let target =
                project::resolve_in_project(&root, &rel).map_err(|e| anyhow!(e.to_string()))?;
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&source, &target)
                .with_context(|| format!("failed to copy {}", source.display()))?;
            println!("{rel}");
        }
        AssetCommand::SaveImage { name, file } => {
            use base64::Engine;
            let bytes = std::fs::read(&file)
                .with_context(|| format!("failed to read {}", file.display()))?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            let saved = project::save_image_asset_in(&root, &name, &b64)
                .await
                .map_err(|e| anyhow!(e.to_string()))?;
            println!("{}", serde_json::to_string_pretty(&saved)?);
        }
        AssetCommand::SaveVideo { name, file } => {
            let source = file.to_string_lossy().into_owned();
            let saved = project::save_video_asset_in(&root, &name, None, Some(&source))
                .await
                .map_err(|e| anyhow!(e.to_string()))?;
            println!("{}", serde_json::to_string_pretty(&saved)?);
        }
        AssetCommand::RecordVoice {
            line_id,
            duration,
            file,
        } => {
            let bytes = std::fs::read(&file)
                .with_context(|| format!("failed to read {}", file.display()))?;
            let rel = export::save_voice_recording_in(&root, &line_id, duration, &bytes)
                .map_err(|e| anyhow!(e.to_string()))?;
            println!("{rel}");
        }
    }
    Ok(())
}

pub async fn run_key(command: KeyCommand) -> Result<()> {
    match command {
        KeyCommand::Get { service } => match Keychain::get_secret(&service) {
            Some(value) => println!("{value}"),
            None => anyhow::bail!("no secret stored for '{service}'"),
        },
        KeyCommand::Set { service, value } => {
            Keychain::set_secret(&service, &value).map_err(|e| anyhow!(e))?;
            println!("stored {service}");
        }
        KeyCommand::Delete { service } => {
            Keychain::delete_secret(&service).map_err(|e| anyhow!(e))?;
            println!("deleted {service}");
        }
    }
    Ok(())
}

#[derive(Debug)]
enum AgentAction {
    Prompt(String),
    Chat,
    Auth(String),
    SetConfig(String, Value),
}

struct StdoutEvents;

impl SessionEvents for StdoutEvents {
    fn emit(&self, event: &str, payload: Value) {
        println!("{}", json!({ "event": event, "payload": payload }));
    }
}

pub async fn run_agent(project: &Path, command: AgentCommand) -> Result<()> {
    let root = project_root(project)?;
    let settings_file = agents_settings_path();

    match command {
        AgentCommand::List { json: as_json } => {
            let statuses = detect_agents().await;
            if as_json {
                println!("{}", serde_json::to_string_pretty(&statuses)?);
            } else {
                for status in statuses {
                    let version = status.version.unwrap_or_default();
                    let binary = status.binary.unwrap_or_default();
                    println!(
                        "{:<10} {:<14} {:<12} {}",
                        status.id,
                        format!("{:?}", status.state),
                        version,
                        binary
                    );
                }
            }
        }
        AgentCommand::Rescan => {
            agents::shell_path::invalidate().await;
            let statuses = detect_agents().await;
            println!("{}", serde_json::to_string_pretty(&statuses)?);
        }
        AgentCommand::InstallAdapter { id } => {
            let path_env = agents::shell_path::login_path().await;
            let registry = agents::builtin_registry();
            let entry = registry
                .iter()
                .find(|e| e.id == id)
                .ok_or_else(|| anyhow!("Unknown agent '{id}'"))?;
            match &entry.launch {
                agents::Launch::Adapter {
                    package, version, ..
                } => {
                    let npm = agents::find_bin("npm", &path_env)
                        .ok_or_else(|| anyhow!("npm was not found on PATH"))?;
                    let dir = adapters_dir().join(&entry.id);
                    agents::install::install_adapter(
                        &npm,
                        &path_env,
                        &dir,
                        package,
                        version,
                        |line| println!("{line}"),
                    )
                    .await
                    .map_err(|e| anyhow!(e.to_string()))?;
                    println!("installed {} adapter into {}", entry.id, dir.display());
                }
                _ => anyhow::bail!("{} is a native agent and has no adapter", entry.name),
            }
        }
        AgentCommand::Settings { json: as_json } => {
            let settings = agents::settings::load_settings(&settings_file);
            if as_json {
                println!("{}", serde_json::to_string_pretty(&settings)?);
            } else {
                println!("settings: {}", settings_file.display());
                println!("default: {:?}", settings.default_agent);
                println!("project overrides: {:?}", settings.project_agents);
                for custom in &settings.custom {
                    println!(
                        "custom: {} -> {} {:?}",
                        custom.id, custom.command, custom.args
                    );
                }
            }
        }
        AgentCommand::SetDefault { id } => {
            let mut settings = agents::settings::load_settings(&settings_file);
            settings.default_agent = Some(id.clone());
            agents::settings::save_settings(&settings_file, &settings)
                .map_err(|e| anyhow!(e.to_string()))?;
            println!("default agent: {id}");
        }
        AgentCommand::Prompt { text, agent, .. } => {
            run_agent_session(&root, agent, AgentAction::Prompt(text)).await?;
        }
        AgentCommand::Chat { agent, .. } => {
            run_agent_session(&root, agent, AgentAction::Chat).await?;
        }
        AgentCommand::Auth { method, agent } => {
            run_agent_session(&root, agent, AgentAction::Auth(method)).await?;
        }
        AgentCommand::SetConfig {
            config_id,
            value,
            agent,
        } => {
            let parsed = serde_json::from_str(&value).unwrap_or(Value::String(value));
            run_agent_session(&root, agent, AgentAction::SetConfig(config_id, parsed)).await?;
        }
        AgentCommand::Disconnect => {
            println!("No persistent agent session is kept between CLI invocations.");
        }
    }
    Ok(())
}

async fn detect_agents() -> Vec<agents::AgentStatus> {
    let path_env = agents::shell_path::login_path().await;
    let registry = agents::builtin_registry();
    agents::detect(&registry, &path_env, &adapters_dir()).await
}

async fn run_agent_session(root: &Path, agent: Option<String>, action: AgentAction) -> Result<()> {
    let path_env = agents::shell_path::login_path().await;
    let settings = agents::settings::load_settings(&agents_settings_path());
    let registry_entries = agents::builtin_registry();
    let id = agent
        .or_else(|| agents::settings::agent_for_project(&settings, &root.to_string_lossy()))
        .ok_or_else(|| {
            anyhow!("No agent selected; pass --agent or run `liosvideo agent set-default <id>`")
        })?;

    let spec = agents::launch_spec(
        &id,
        &registry_entries,
        &settings,
        &path_env,
        &adapters_dir(),
    )
    .map_err(|e| anyhow!(e.to_string()))?;

    let mut command = tokio::process::Command::new(&spec.command);
    command
        .args(&spec.args)
        .envs(spec.env)
        .current_dir(root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    for key in [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "ELEVENLABS_API_KEY",
        "GOOGLE_TTS_API_KEY",
    ] {
        if let Some(value) = Keychain::get_secret(key) {
            command.env(key, value);
        }
    }

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start agent '{}'", spec.command.display()))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("agent stdin unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("agent stdout unavailable"))?;

    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[agent] {line}");
            }
        });
    }

    // Headless MCP server so the agent can call render_frame / tts_generate / etc.
    let shared = Arc::new(Mutex::new(EditorSession::new(root.to_path_buf())));
    let mut tool_registry = ToolRegistry::new();
    headless_tools::register_all(&mut tool_registry, shared);
    let server = McpServer::bind(Arc::new(tool_registry))?;

    let session = Session::connect(
        stdout,
        stdin,
        root.to_path_buf(),
        id.clone(),
        Arc::new(StdoutEvents),
    );
    session.child.lock().unwrap().replace(child);
    session.set_mcp_port(server.port());
    session.set_auto_approve(true);

    session.start().await.map_err(|e| anyhow!(e.to_string()))?;

    let result = match action {
        AgentAction::Prompt(text) => session
            .prompt(&text, None, None)
            .await
            .map(|stop| println!("stop: {stop}"))
            .map_err(|e| anyhow!(e.to_string())),
        AgentAction::Chat => chat_loop(&session).await,
        AgentAction::Auth(method) => session
            .authenticate(&method)
            .await
            .map(|_| println!("authenticated"))
            .map_err(|e| anyhow!(e.to_string())),
        AgentAction::SetConfig(config_id, value) => session
            .set_config_option(&config_id, value)
            .await
            .map(|v| println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default()))
            .map_err(|e| anyhow!(e.to_string())),
    };

    session.close();
    drop(server);
    result
}

async fn chat_loop(session: &Arc<Session>) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    let stdin = tokio::io::stdin();
    let mut lines = tokio::io::BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();
    stdout
        .write_all(b"liosvideo agent chat - type a prompt, Ctrl-D to exit\n")
        .await?;

    while let Some(line) = lines.next_line().await? {
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        if text == "/exit" || text == "/quit" {
            break;
        }
        if text == "/cancel" {
            session.cancel().await;
            continue;
        }
        if let Err(err) = session.prompt(text, None, None).await {
            eprintln!("prompt failed: {err}");
        }
    }
    Ok(())
}

fn mcp_registry(root: &Path) -> Arc<ToolRegistry> {
    let shared = Arc::new(Mutex::new(EditorSession::new(root.to_path_buf())));
    let mut registry = ToolRegistry::new();
    headless_tools::register_all(&mut registry, shared);
    Arc::new(registry)
}

pub async fn run_mcp(project: &Path, command: McpCommand) -> Result<()> {
    let root = project_root(project)?;
    match command {
        McpCommand::Serve { stdio, tcp, .. } => {
            let registry = mcp_registry(&root);
            if let Some(addr) = tcp {
                let server = McpServer::bind_addr(&addr, registry)?;
                println!("MCP server listening on 127.0.0.1:{}", server.port());
                tokio::signal::ctrl_c().await?;
                server.stop();
            } else {
                let _ = stdio;
                serve_stdio(registry).await?;
            }
        }
        McpCommand::Tools { json: _ } => {
            let registry = mcp_registry(&root);
            println!("{}", serde_json::to_string_pretty(&registry.list())?);
        }
        McpCommand::Call { tool, args } => {
            let registry = mcp_registry(&root);
            let args: Value = match args {
                Some(raw) => serde_json::from_str(&raw)
                    .with_context(|| format!("invalid JSON arguments: {raw}"))?,
                None => json!({}),
            };
            let result = headless_tools::call_tool(&registry, &tool, args)
                .await
                .map_err(|e| anyhow!(e))?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}

async fn serve_stdio(registry: Arc<ToolRegistry>) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    let mut lines = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();

    while let Some(line) = lines.next_line().await? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(response) = handle_mcp_message(&registry, trimmed).await {
            stdout.write_all(response.as_bytes()).await?;
            stdout.write_all(b"\n").await?;
            stdout.flush().await?;
        }
    }
    Ok(())
}

pub async fn run_watch(project: &Path, exec: Option<String>, debounce: u64) -> Result<()> {
    let root = project_root(project)?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<String>>();
    let _watcher = crate::watch::start(root.clone(), debounce, move |paths| {
        let _ = tx.send(paths);
    })
    .map_err(|e| anyhow!("failed to watch {}: {e}", root.display()))?;

    while let Some(paths) = rx.recv().await {
        for path in &paths {
            println!("{path}");
        }
        if let Some(command) = &exec {
            let status = tokio::process::Command::new("sh")
                .arg("-c")
                .arg(command)
                .current_dir(&root)
                .status()
                .await
                .with_context(|| format!("failed to run '{command}'"))?;
            if !status.success() {
                eprintln!("command exited with {status}");
            }
        }
    }
    Ok(())
}
