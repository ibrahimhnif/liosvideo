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
            loudness,
            no_normalize,
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
                loudness: if no_normalize {
                    Some(None)
                } else {
                    loudness.map(Some)
                },
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
        cli::Commands::Verify { file } => {
            let report = liosvideo_cli::media::integrity::check_file(&file, None)
                .map_err(|e| anyhow::anyhow!("{}: {e}", file.display()))?;
            println!(
                "{}: OK ({} frames, {} keyframes, no missing or duplicated references)",
                file.display(),
                report.frames,
                report.keyframes
            );
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
        cli::Commands::Styles => commands::run_styles(),
        cli::Commands::Watch { exec, debounce } => {
            commands::run_watch(&cli.project, exec, debounce).await?;
        }
    }
    Ok(())
}
