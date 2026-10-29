use clap::Parser;
use liosvideo_cli::{cli, pipeline};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = cli::Cli::parse();
    match args.command {
        cli::Commands::Render { entry, out, .. } => {
            println!("Rendering {} to {}", entry.display(), out.display());
        }
        cli::Commands::Snapshot { entry, out, frame } => {
            pipeline::render_snapshot(&entry, frame, &out).await?;
        }
        cli::Commands::Info { entry, .. } => {
            println!("Inspecting {}", entry.display());
        }
    }
    Ok(())
}
