mod cli;

use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = cli::Cli::parse();
    match args.command {
        cli::Commands::Render { entry, out, .. } => {
            println!("Rendering {} to {}", entry.display(), out.display());
        }
        cli::Commands::Snapshot { entry, out, frame } => {
            println!("Snapshot frame {} of {} to {}", frame, entry.display(), out.display());
        }
        cli::Commands::Info { entry, .. } => {
            println!("Inspecting {}", entry.display());
        }
    }
    Ok(())
}
