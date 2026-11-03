use clap::{CommandFactory, Parser};
use liosvideo_cli::cli::{self, commands};
use liosvideo_cli::pipeline::{self, Preset};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = cli::Cli::parse();

    if let Some(port) = cli.mcp_bridge {
        liosvideo_cli::mcp::run_bridge(port).map_err(|e| anyhow::anyhow!("{e}"))?;
        return Ok(());
    }

    let Some(command) = cli.command else {
        cli::Cli::command().print_help()?;
        return Ok(());
    };

    match command {
        cli::Commands::Render {
            entry,
            out,
            fps,
            frames,
            quality,
            preset,
            bitrate,
            audio_bitrate,
            quiet,
        } => {
            let config = pipeline::RenderConfig {
                entry,
                out,
                fps,
                frames,
                quality,
                preset: Preset::parse(&preset)?,
                bitrate,
                audio_bitrate,
                quiet,
            };
            pipeline::run_render_job(config).await?;
        }
        cli::Commands::Snapshot {
            entry,
            out,
            frame,
            preset,
        } => {
            pipeline::render_snapshot(&entry, frame, &out, Preset::parse(&preset)?).await?;
        }
        cli::Commands::Info { entry, json } => {
            pipeline::run_info_job(&entry, json).await?;
        }
        cli::Commands::Validate { path, json } => {
            commands::run_validate(&cli.project, path, json).await?;
        }
        cli::Commands::History { command } => {
            commands::run_history(&cli.project, command).await?;
        }
        cli::Commands::Project { command } => {
            commands::run_project(&cli.project, command).await?;
        }
        cli::Commands::Tts { command } => {
            commands::run_tts(&cli.project, command).await?;
        }
        cli::Commands::Asset { command } => {
            commands::run_asset(&cli.project, command).await?;
        }
        cli::Commands::Key { command } => {
            commands::run_key(command).await?;
        }
        cli::Commands::Agent { command } => {
            commands::run_agent(&cli.project, command).await?;
        }
        cli::Commands::Mcp { command } => {
            commands::run_mcp(&cli.project, command).await?;
        }
        cli::Commands::Watch { exec, debounce } => {
            commands::run_watch(&cli.project, exec, debounce).await?;
        }
    }
    Ok(())
}
