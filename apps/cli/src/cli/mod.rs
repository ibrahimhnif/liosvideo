use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "liosvideo", version, about = "Deterministic declarative video renderer")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum Commands {
    Render {
        entry: PathBuf,
        #[arg(short, long, default_value = "out/output.mp4")]
        out: PathBuf,
        #[arg(long)]
        fps: Option<f64>,
        #[arg(long)]
        frames: Option<String>,
        #[arg(long, default_value = "medium")]
        quality: String,
        #[arg(long)]
        quiet: bool,
    },
    Snapshot {
        entry: PathBuf,
        #[arg(short, long, default_value = "out/snapshot.png")]
        out: PathBuf,
        #[arg(long, default_value_t = 0)]
        frame: usize,
    },
    Info {
        entry: PathBuf,
        #[arg(long)]
        json: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_render_command() {
        let cli = Cli::parse_from(["liosvideo", "render", "long.ts", "-o", "video.mp4"]);
        assert_eq!(
            cli.command,
            Commands::Render {
                entry: PathBuf::from("long.ts"),
                out: PathBuf::from("video.mp4"),
                fps: None,
                frames: None,
                quality: "medium".into(),
                quiet: false,
            }
        );
    }

    #[test]
    fn parses_snapshot_command() {
        let cli = Cli::parse_from(["liosvideo", "snapshot", "short.ts", "--frame", "42"]);
        assert_eq!(
            cli.command,
            Commands::Snapshot {
                entry: PathBuf::from("short.ts"),
                out: PathBuf::from("out/snapshot.png"),
                frame: 42,
            }
        );
    }

    #[test]
    fn parses_info_command() {
        let cli = Cli::parse_from(["liosvideo", "info", "long.ts", "--json"]);
        assert_eq!(
            cli.command,
            Commands::Info {
                entry: PathBuf::from("long.ts"),
                json: true,
            }
        );
    }
}
