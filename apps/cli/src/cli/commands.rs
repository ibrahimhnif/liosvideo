use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};

use crate::acp::session::{Session, SessionEvents};
use crate::agents;
use crate::cli::{
    AgentCommand, AssetCommand, CommonsCommand, ConversationCommand, HistoryCommand, KeyCommand, McpCommand,
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

/// Prints `id  title` for each animation style.
pub fn run_styles() {
    for (id, title) in scaffold::STYLES {
        println!("{id:<14}{title}");
    }
}

pub async fn run_project(project: &Path, command: ProjectCommand) -> Result<()> {
    match command {
        ProjectCommand::New {
            parent,
            name,
            template,
            style,
        } => {
            let path = scaffold::create_project_in(&parent, &name, template.as_deref(), style.as_deref())
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
            force,
        } => {
            let outcome = headless_tools::generate_line(&root, &line_id, &text, voice.as_deref(), force)
                .await
                .map_err(|e| anyhow!(e))?;
            let result = outcome.result;
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "line_id": result.line_id,
                    "audio_path": result.audio_rel_path,
                    "timing_path": result.timing_rel_path,
                    "duration": result.duration,
                    "words": result.words,
                    "cached": outcome.cached,
                    "cost_usd": outcome.cost_usd,
                    "stats": outcome.stats,
                }))?
            );
        }
        TtsCommand::Sync { script, voice, force } => {
            let path = if script.is_absolute() { script } else { root.join(script) };
            let markdown = std::fs::read_to_string(&path)
                .with_context(|| format!("Could not read {}", path.display()))?;
            let lines = crate::tts::cache::script_lines(&markdown);
            if lines.is_empty() {
                return Err(anyhow!("No `<!-- vo:<id> -->` lines found in {}", path.display()));
            }
            let (mut generated, mut cached, mut spent, mut saved) = (0, 0, 0.0, 0.0);
            for (id, text) in &lines {
                let outcome = headless_tools::generate_line(&root, id, text, voice.as_deref(), force)
                    .await
                    .map_err(|e| anyhow!("{id}: {e}"))?;
                let state = if outcome.cached { "cached   " } else { "generated" };
                println!("{state}  {id}  ({:.1}s)", outcome.result.duration);
                if outcome.cached {
                    cached += 1;
                    saved += outcome.cost_usd;
                } else {
                    generated += 1;
                    spent += outcome.cost_usd;
                }
            }
            println!(
                "{generated} generated (~${spent:.4}), {cached} cached (~${saved:.4} saved)"
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
        AssetCommand::Search {
            query,
            page,
            include_disturbing,
            json,
        } => {
            let found = crate::destockd::search(&query, page, include_disturbing)
                .await
                .map_err(|e| anyhow!(e))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&found)?);
            } else if found.hits.is_empty() {
                println!("No Destockd shots for \"{query}\" (page {}).", found.page);
            } else {
                println!("{} shot(s) for \"{}\" (page {}):\n", found.hits.len(), found.query, found.page);
                for hit in &found.hits {
                    println!(
                        "{:<48} {:<10} {:<6} {}",
                        truncate(&hit.film, 48),
                        hit.shot,
                        if hit.color_type.is_empty() { "-" } else { &hit.color_type },
                        hit.clip
                    );
                }
                if found.has_more {
                    println!("\nMore results: --page {}", found.page + 1);
                }
                println!("\n{}", crate::destockd::RIGHTS_NOTICE);
            }
        }
        AssetCommand::Download {
            film,
            shot,
            name,
            force,
        } => {
            let saved = crate::destockd::download(&root, &film, &shot, name.as_deref(), force)
                .await
                .map_err(|e| anyhow!(e))?;
            println!("{}", serde_json::to_string_pretty(&saved)?);
        }
        AssetCommand::Commons { command } => commons_command(&root, command).await?,
        AssetCommand::GenerateImage {
            prompt,
            id,
            aspect,
            size,
            model,
            refs,
        } => {
            let opts = crate::imagegen::GenerateOptions { aspect, size, model, refs };
            let entry = crate::imagegen::generate(&root, &gemini_key(), &id, &prompt, opts)
                .await
                .map_err(|e| anyhow!(e))?;
            print_image(&entry);
        }
        AssetCommand::EditImage { id, instruction, size } => {
            let entry = crate::imagegen::edit(&root, &gemini_key(), &id, &instruction, size)
                .await
                .map_err(|e| anyhow!(e))?;
            print_image(&entry);
        }
        AssetCommand::Images { id, json } => {
            let images: Vec<_> = crate::imagegen::load_manifest(&root)
                .images
                .into_iter()
                .filter(|e| id.as_deref().is_none_or(|id| e.id == id))
                .collect();
            if json {
                println!("{}", serde_json::to_string_pretty(&images)?);
            } else if images.is_empty() {
                println!("No generated images yet. Try: liosvideo asset generate-image \"…\" --id hero");
            } else {
                for entry in &images {
                    println!("{}  →  {}  (v{} of {})", entry.id, entry.src, entry.active, entry.versions.len());
                    for v in &entry.versions {
                        let mark = if v.n == entry.active { "*" } else { " " };
                        let kind = if v.from.is_some() { "revise" } else { "prompt" };
                        println!("  {mark} v{:<3} {kind}: {}", v.n, truncate(&v.prompt, 90));
                    }
                }
            }
        }
        AssetCommand::UseImage { id, version } => {
            let entry = crate::imagegen::use_version(&root, &id, version).map_err(|e| anyhow!(e))?;
            print_image(&entry);
        }
    }
    Ok(())
}

fn gemini_key() -> String {
    crate::imagegen::KEY_NAMES
        .iter()
        .find_map(|name| Keychain::get_secret(name))
        .unwrap_or_default()
}

fn print_image(entry: &crate::imagegen::ImageEntry) {
    println!("{}  (v{} of {})", entry.src, entry.active, entry.versions.len());
    println!("Use it: image({{ src: \"{}\", fit: \"cover\" }})", entry.src);
    println!("Revise: liosvideo asset edit-image {} \"<what to change>\"", entry.id);
}

async fn commons_command(root: &Path, command: CommonsCommand) -> Result<()> {
    match command {
        CommonsCommand::Search { query, page, limit, json } => {
            let found = crate::commons::search(&query, page, limit).await.map_err(|e| anyhow!(e))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&found)?);
                return Ok(());
            }
            if found.hits.is_empty() {
                println!("No Commons files for \"{query}\" (page {}).", found.page);
                return Ok(());
            }
            println!("{} file(s) for \"{}\" (page {}):\n", found.hits.len(), found.query, found.page);
            for hit in &found.hits {
                let licence = if hit.reusable {
                    hit.licence.clone()
                } else {
                    format!("UNAVAILABLE: {}", hit.refused.as_deref().unwrap_or("licence"))
                };
                println!(
                    "{:<52} {:>5}x{:<5} {:<24} {}",
                    truncate(&hit.title, 52),
                    hit.width,
                    hit.height,
                    truncate(&hit.author, 24),
                    licence
                );
            }
            if found.has_more {
                println!("\nMore results: --page {}", found.page + 1);
            }
            println!("\nDownload: liosvideo asset commons download \"<File:…>\"");
        }
        CommonsCommand::Download { file, name, width, force } => {
            let saved = crate::commons::download(root, &file, name.as_deref(), width, force)
                .await
                .map_err(|e| anyhow!(e))?;
            println!("{}", serde_json::to_string_pretty(&saved)?);
        }
    }
    Ok(())
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let head: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{head}…")
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
    Prompt(String, Option<String>),
    Chat(Option<String>),
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
        AgentCommand::Prompt {
            text,
            agent,
            handoff,
        } => {
            run_agent_session(&root, agent, AgentAction::Prompt(text, handoff)).await?;
        }
        AgentCommand::Chat { agent, handoff } => {
            run_agent_session(&root, agent, AgentAction::Chat(handoff)).await?;
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

    let handoff_text = match &action {
        AgentAction::Prompt(_, Some(spec)) | AgentAction::Chat(Some(spec)) => {
            Some(read_handoff(root, spec)?)
        }
        _ => None,
    };

    let result = match action {
        AgentAction::Prompt(text, _) => {
            let prompt = merge_handoff(handoff_text.as_deref(), &text);
            session
                .prompt(&prompt, None, None)
                .await
                .map(|stop| println!("stop: {stop}"))
                .map_err(|e| anyhow!(limit_hint(&e.to_string())))
        }
        AgentAction::Chat(_) => chat_loop(&session, handoff_text).await,
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

/// Reads `--handoff auto` (`.liosvideo/handoff.md`) or an explicit path.
fn read_handoff(root: &Path, spec: &str) -> Result<String> {
    let path = if spec == "auto" {
        root.join(".liosvideo").join("handoff.md")
    } else {
        PathBuf::from(spec)
    };
    std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read handoff {}", path.display()))
}

fn merge_handoff(handoff: Option<&str>, text: &str) -> String {
    match handoff {
        Some(handoff) if !handoff.trim().is_empty() => {
            format!("{}\n\n---\n\n{text}", handoff.trim_end())
        }
        _ => text.to_string(),
    }
}

/// Appends a recovery hint to usage-limit/auth/model failures so the next command is obvious.
fn limit_hint(message: &str) -> String {
    let Some(info) = crate::acp::limits::detect(message) else {
        return message.to_string();
    };
    let kind = match info.kind {
        crate::acp::limits::LimitKind::UsageLimit => "usage limit",
        crate::acp::limits::LimitKind::Auth => "authentication",
        crate::acp::limits::LimitKind::ModelUnavailable => "model availability",
    };
    format!(
        "{message}\n\nThis is a {kind} failure. Continue on another agent/model:\n  \
         liosvideo agent chat --agent <id> --handoff .liosvideo/handoff.md\n\
         (build that file from the desktop chat, which renders a budgeted handoff automatically)."
    )
}

async fn chat_loop(session: &Arc<Session>, handoff: Option<String>) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

    let stdin = tokio::io::stdin();
    let mut lines = tokio::io::BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();
    stdout
        .write_all(b"liosvideo agent chat - type a prompt, Ctrl-D to exit\n")
        .await?;

    let mut pending_handoff = handoff;
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
        let prompt = merge_handoff(pending_handoff.as_deref(), text);
        pending_handoff = None;
        if let Err(err) = session.prompt(&prompt, None, None).await {
            eprintln!("prompt failed: {}", limit_hint(&err.to_string()));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_a_handoff_before_the_prompt() {
        assert_eq!(merge_handoff(Some("HISTORY"), "next"), "HISTORY\n\n---\n\nnext");
        assert_eq!(merge_handoff(Some("  "), "next"), "next");
        assert_eq!(merge_handoff(None, "next"), "next");
    }

    #[test]
    fn hints_recovery_only_for_limit_failures() {
        assert!(limit_hint("429 Too Many Requests").contains("--handoff"));
        assert!(limit_hint("You've hit your 5-hour limit").contains("usage limit"));
        assert_eq!(limit_hint("compile failed"), "compile failed");
    }

    #[test]
    fn reads_auto_handoff_from_the_project() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".liosvideo")).unwrap();
        std::fs::write(dir.path().join(".liosvideo/handoff.md"), "HISTORY").unwrap();
        assert_eq!(read_handoff(dir.path(), "auto").unwrap(), "HISTORY");
        assert!(read_handoff(dir.path(), "missing.md").is_err());
    }
}
