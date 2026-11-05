pub mod commands;
pub mod progress;

pub use progress::RenderProgressBar;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "liosvideo",
    version,
    about = "Deterministic declarative video renderer"
)]
pub struct Cli {
    /// Project directory (defaults to the current directory)
    #[arg(long, global = true, value_name = "DIR", default_value = ".")]
    pub project: PathBuf,

    /// Internal MCP stdio↔TCP bridge used when spawning ACP agents
    #[arg(long, hide = true)]
    pub mcp_bridge: Option<u16>,

    #[command(subcommand)]
    pub command: Option<Commands>,
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
        /// Encoding quality preset (low, medium, high); ignored when --bitrate is set
        #[arg(long)]
        quality: Option<String>,
        /// Output resolution preset (native, 1080p, 4k, shorts)
        #[arg(long, default_value = "native")]
        preset: String,
        /// H.264 bitrate in bits per second
        #[arg(long)]
        bitrate: Option<u32>,
        /// AAC bitrate in bits per second
        #[arg(long)]
        audio_bitrate: Option<u32>,
        #[arg(long)]
        quiet: bool,
    },
    Snapshot {
        entry: PathBuf,
        #[arg(short, long, default_value = "out/snapshot.png")]
        out: PathBuf,
        #[arg(long, default_value_t = 0)]
        frame: usize,
        /// Output resolution preset (native, 1080p, 4k, shorts)
        #[arg(long, default_value = "native")]
        preset: String,
    },
    Info {
        entry: PathBuf,
        #[arg(long)]
        json: bool,
    },
    Validate {
        /// Optional relative scene file; defaults to every scene under scenes/
        path: Option<String>,
        #[arg(long)]
        json: bool,
    },
    History {
        #[command(subcommand)]
        command: HistoryCommand,
    },
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
    Tts {
        #[command(subcommand)]
        command: TtsCommand,
    },
    Asset {
        #[command(subcommand)]
        command: AssetCommand,
    },
    Key {
        #[command(subcommand)]
        command: KeyCommand,
    },
    Agent {
        #[command(subcommand)]
        command: AgentCommand,
    },
    Mcp {
        #[command(subcommand)]
        command: McpCommand,
    },
    /// List the animation styles `project new --style` accepts
    Styles,
    Watch {
        /// Command to run after a debounced change set
        #[arg(long)]
        exec: Option<String>,
        #[arg(long, default_value_t = 100)]
        debounce: u64,
    },
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum HistoryCommand {
    Status,
    Enable,
    Log {
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    Diff {
        commit: String,
    },
    Checkpoint {
        #[arg(short, long)]
        message: String,
    },
    Restore {
        commit: String,
    },
    RevertFiles {
        commit: String,
        paths: Vec<String>,
    },
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum ProjectCommand {
    New {
        parent: PathBuf,
        name: String,
        #[arg(long)]
        template: Option<String>,
        /// Animation style id (see `liosvideo styles`)
        #[arg(long)]
        style: Option<String>,
    },
    Info,
    Recent {
        #[arg(long, default_value_t = 10)]
        limit: usize,
    },
    Stats {
        #[arg(long)]
        json: bool,
    },
    /// Record LLM token usage in .liosvideo/stats.json
    TokenUsage {
        #[arg(long)]
        input: usize,
        #[arg(long)]
        output: usize,
        #[arg(long)]
        model: Option<String>,
    },
    Conversation {
        #[command(subcommand)]
        command: ConversationCommand,
    },
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum ConversationCommand {
    Get,
    Set {
        #[arg(long)]
        file: PathBuf,
    },
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum TtsCommand {
    Voices,
    Generate {
        #[arg(long)]
        line_id: String,
        #[arg(long)]
        text: String,
        #[arg(long)]
        voice: Option<String>,
    },
    Timings,
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum AssetCommand {
    /// Copy an external file into assets/<id>.<ext>
    Import {
        id: String,
        source: PathBuf,
    },
    SaveImage {
        name: String,
        file: PathBuf,
    },
    SaveVideo {
        name: String,
        file: PathBuf,
    },
    RecordVoice {
        line_id: String,
        duration: f64,
        file: PathBuf,
    },
    /// Search free archival footage on Destockd (CLIP visual search)
    Search {
        query: String,
        #[arg(long, default_value_t = 1)]
        page: u32,
        /// Include footage Destockd hides from its homepage (violence/nudity disclaimer)
        #[arg(long)]
        include_disturbing: bool,
        #[arg(long)]
        json: bool,
    },
    /// Download a Destockd shot into assets/video and record its attribution
    Download {
        film: String,
        shot: String,
        /// Output filename (default: "<film> - <shot>.mp4")
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum KeyCommand {
    Get { service: String },
    Set { service: String, value: String },
    Delete { service: String },
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum AgentCommand {
    List {
        #[arg(long)]
        json: bool,
    },
    Rescan,
    InstallAdapter {
        id: String,
    },
    Settings {
        #[arg(long)]
        json: bool,
    },
    SetDefault {
        id: String,
    },
    /// Connect and start an interactive prompt loop on stdin
    Chat {
        #[arg(long)]
        agent: Option<String>,
        /// Prepend a context handoff file (`auto` = .liosvideo/handoff.md) to the first prompt
        #[arg(long)]
        handoff: Option<String>,
    },
    /// One-shot prompt; prints streamed agent events as JSON lines
    Prompt {
        text: String,
        #[arg(long)]
        agent: Option<String>,
        /// Prepend a context handoff file (`auto` = .liosvideo/handoff.md)
        #[arg(long)]
        handoff: Option<String>,
    },
    Auth {
        method: String,
        #[arg(long)]
        agent: Option<String>,
    },
    SetConfig {
        config_id: String,
        value: String,
        #[arg(long)]
        agent: Option<String>,
    },
    Disconnect,
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum McpCommand {
    Serve {
        #[arg(long)]
        stdio: bool,
        #[arg(long)]
        tcp: Option<String>,
    },
    Tools {
        #[arg(long)]
        json: bool,
    },
    Call {
        tool: String,
        /// JSON object with the tool arguments
        args: Option<String>,
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
            Some(Commands::Render {
                entry: PathBuf::from("long.ts"),
                out: PathBuf::from("video.mp4"),
                fps: None,
                frames: None,
                quality: None,
                preset: "native".into(),
                bitrate: None,
                audio_bitrate: None,
                quiet: false,
            })
        );
    }

    #[test]
    fn parses_render_with_export_options() {
        let cli = Cli::parse_from([
            "liosvideo",
            "render",
            "long.ts",
            "--preset",
            "4k",
            "--bitrate",
            "30000000",
            "--audio-bitrate",
            "192000",
        ]);
        match cli.command {
            Some(Commands::Render {
                preset,
                bitrate,
                audio_bitrate,
                ..
            }) => {
                assert_eq!(preset, "4k");
                assert_eq!(bitrate, Some(30_000_000));
                assert_eq!(audio_bitrate, Some(192_000));
            }
            _ => panic!("expected render"),
        }
    }

    #[test]
    fn parses_snapshot_command() {
        let cli = Cli::parse_from(["liosvideo", "snapshot", "short.ts", "--frame", "42"]);
        assert_eq!(
            cli.command,
            Some(Commands::Snapshot {
                entry: PathBuf::from("short.ts"),
                out: PathBuf::from("out/snapshot.png"),
                frame: 42,
                preset: "native".into(),
            })
        );
    }

    #[test]
    fn parses_info_command() {
        let cli = Cli::parse_from(["liosvideo", "info", "long.ts", "--json"]);
        assert_eq!(
            cli.command,
            Some(Commands::Info {
                entry: PathBuf::from("long.ts"),
                json: true,
            })
        );
    }

    #[test]
    fn parses_backend_commands() {
        let cli = Cli::parse_from(["liosvideo", "validate", "--json", "--project", "/tmp/x"]);
        assert_eq!(cli.project, PathBuf::from("/tmp/x"));
        assert_eq!(
            cli.command,
            Some(Commands::Validate {
                path: None,
                json: true
            })
        );

        let cli = Cli::parse_from([
            "liosvideo",
            "tts",
            "generate",
            "--line-id",
            "l1",
            "--text",
            "hi",
        ]);
        match cli.command {
            Some(Commands::Tts {
                command:
                    TtsCommand::Generate {
                        line_id,
                        text,
                        voice,
                    },
            }) => {
                assert_eq!(line_id, "l1");
                assert_eq!(text, "hi");
                assert_eq!(voice, None);
            }
            _ => panic!("expected tts generate"),
        }
    }

    #[test]
    fn parses_project_new_with_style_and_styles() {
        let cli = Cli::parse_from(["liosvideo", "project", "new", "/tmp", "x", "--style", "comic"]);
        assert_eq!(
            cli.command,
            Some(Commands::Project {
                command: ProjectCommand::New {
                    parent: PathBuf::from("/tmp"),
                    name: "x".into(),
                    template: None,
                    style: Some("comic".into()),
                },
            })
        );
        let cli = Cli::parse_from(["liosvideo", "styles"]);
        assert_eq!(cli.command, Some(Commands::Styles));
    }
}
