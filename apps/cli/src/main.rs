use clap::Parser;
use liosvideo_cli::{cli, pipeline};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = cli::Cli::parse();
    match args.command {
        cli::Commands::Render {
            entry,
            out,
            fps,
            frames,
            quality,
            quiet,
        } => {
            let config = pipeline::RenderConfig {
                entry,
                out,
                fps,
                frames,
                quality,
                quiet,
            };
            pipeline::run_render_job(config).await?;
        }
        cli::Commands::Snapshot { entry, out, frame } => {
            pipeline::render_snapshot(&entry, frame, &out).await?;
        }
        cli::Commands::Info { entry, json } => {
            pipeline::run_info_job(&entry, json).await?;
        }
    }
    Ok(())
}
