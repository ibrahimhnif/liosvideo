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
        /// Output preset: native, 1080p, 4k, shorts, preview (720p, small), tiktok, reels, youtube
        #[arg(long, default_value = "native")]
        preset: String,
        /// H.264 bitrate in bits per second
        #[arg(long)]
        bitrate: Option<u32>,
        /// AAC bitrate in bits per second
        #[arg(long)]
        audio_bitrate: Option<u32>,
        /// Integrated loudness target in LUFS (default: the composition's mix, else -14)
        #[arg(long, allow_hyphen_values = true)]
        loudness: Option<f64>,
        /// Keep the raw mix level (the -1 dBFS limiter still runs)
        #[arg(long, conflicts_with = "loudness")]
        no_normalize: bool,
        /// H.264 encoder: auto (VideoToolbox on macOS, else OpenH264), hardware, software
        #[arg(long, default_value = "auto")]
        encoder: String,
        #[arg(long)]
        quiet: bool,
    },
    Snapshot {
        entry: PathBuf,
        #[arg(short, long, default_value = "out/snapshot.png")]
        out: PathBuf,
        #[arg(long, default_value_t = 0)]
        frame: usize,
        /// Time in seconds instead of a frame number (e.g. --time 3.2)
        #[arg(long, conflicts_with = "frame")]
        time: Option<f64>,
        /// Output preset: native, 1080p, 4k, shorts, preview (720p, small), tiktok, reels, youtube
        #[arg(long, default_value = "native")]
        preset: String,
    },
    /// One image of labelled frames: one per scene (default) or every N seconds
    ContactSheet {
        entry: PathBuf,
        #[arg(short, long, default_value = "out/contact-sheet.png")]
        out: PathBuf,
        /// One frame per scene (the default)
        #[arg(long, conflicts_with = "every")]
        per_scene: bool,
        /// A frame every interval instead, e.g. 2s, 1.5 or 500ms
        #[arg(long)]
        every: Option<String>,
        #[arg(long, default_value_t = 4)]
        cols: u32,
        /// Width of each frame in pixels
        #[arg(long, default_value_t = 480)]
        width: u32,
    },
    Info {
        entry: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Check an MP4's H.264 stream for corrupted frames (missing/duplicated references)
    Verify { file: PathBuf },
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
    /// Generate one line (reuses the existing audio when text, voice and provider are unchanged)
    Generate {
        #[arg(long)]
        line_id: String,
        #[arg(long)]
        text: String,
        #[arg(long)]
        voice: Option<String>,
        /// Regenerate even if the cached audio matches
        #[arg(long)]
        force: bool,
    },
    /// Generate every `<!-- vo:id -->` line of script.md; unchanged lines are reused, not re-billed
    Sync {
        #[arg(long, default_value = "script.md")]
        script: PathBuf,
        #[arg(long)]
        voice: Option<String>,
        #[arg(long)]
        force: bool,
    },
    Timings,
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum CommonsCommand {
    /// Search photos and drawings; each hit says whether its licence allows reuse
    Search {
        query: String,
        #[arg(long, default_value_t = 1)]
        page: u32,
        #[arg(long, default_value_t = 12)]
        limit: u32,
        #[arg(long)]
        json: bool,
    },
    /// Download a file into assets/images (CC0, public domain, CC BY, CC BY-SA only) and record its attribution
    Download {
        /// "File:Name.jpg", "Name.jpg" or the file's commons.wikimedia.org URL
        file: String,
        /// Output file name without extension (default: the Commons file name)
        #[arg(long)]
        name: Option<String>,
        /// Download a thumbnail this many pixels wide instead of the original
        #[arg(long)]
        width: Option<u32>,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum AudioCommand {
    /// Search sound effects (Freesound) and music (Jamendo, Wikimedia Commons) on Openverse
    Search {
        query: String,
        /// sfx, music or any
        #[arg(long, default_value = "any")]
        kind: String,
        #[arg(long, default_value_t = 1)]
        page: u32,
        #[arg(long, default_value_t = 10)]
        limit: u32,
        #[arg(long)]
        json: bool,
    },
    /// Download into assets/audio/sfx|music (CC0, public domain, CC BY, CC BY-SA only) and record its attribution
    Download {
        /// The id from the search, or an openverse.org/audio/<id> URL
        id: String,
        /// sfx or music (default: from the source and length)
        #[arg(long)]
        kind: Option<String>,
        /// Output file name without extension (default: the title)
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand, Debug, PartialEq)]
pub enum SfxCommand {
    /// List earshot's bank of sound effects made in code (needs earshot installed)
    List {
        /// Only one kind, e.g. whoosh, pop, click, riser
        #[arg(long)]
        kind: Option<String>,
    },
    /// Render a bank sound into assets/audio/sfx/<name>.wav, usable as sfx: "<name>"
    Render {
        /// Bank id, e.g. whoosh_fast/crisp
        id: String,
        /// Output file name without extension (default: the id with / as -)
        #[arg(long)]
        name: Option<String>,
        /// Length in seconds
        #[arg(long)]
        dur: Option<f64>,
        /// Seconds from the start to a whoosh's loudest moment
        #[arg(long)]
        apex: Option<f64>,
        /// Note (E5) or Hz, for tonal sounds
        #[arg(long)]
        pitch: Option<String>,
        /// Another take of the same sound
        #[arg(long)]
        seed: Option<u64>,
        #[arg(long)]
        force: bool,
    },
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
    /// Photos from Wikimedia Commons with their licence checked and attribution recorded
    Commons {
        #[command(subcommand)]
        command: CommonsCommand,
    },
    /// Sound effects and music from Openverse with their licence checked and attribution recorded
    Audio {
        #[command(subcommand)]
        command: AudioCommand,
    },
    /// Sound effects made in code by earshot (optional: uv tool install earshot)
    Sfx {
        #[command(subcommand)]
        command: SfxCommand,
    },
    /// Generate an image with Google Gemini (Nano Banana) into assets/images/<id>.png
    GenerateImage {
        /// What the image should show
        prompt: String,
        /// Asset id: the image is saved as assets/images/<id>.png
        #[arg(long)]
        id: String,
        /// Aspect ratio (default: 9:16 for short-only projects, else 16:9)
        #[arg(long)]
        aspect: Option<String>,
        /// Output size: 1K, 2K or 4K
        #[arg(long)]
        size: Option<String>,
        /// Gemini image model
        #[arg(long)]
        model: Option<String>,
        /// Reference image inside the project (repeatable): style, character or product to keep
        #[arg(long = "ref")]
        refs: Vec<String>,
    },
    /// Revise a generated image ("darker sky", "less people") into a new version
    EditImage {
        id: String,
        /// What to change
        instruction: String,
        #[arg(long)]
        size: Option<String>,
    },
    /// List generated images and their versions
    Images {
        id: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Make an earlier version of a generated image the active one
    UseImage {
        id: String,
        version: u32,
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
                loudness: None,
                no_normalize: false,
                encoder: "auto".into(),
                quiet: false,
            })
        );
    }

    #[test]
    fn parses_tts_cache_options() {
        let cli = Cli::parse_from(["liosvideo", "tts", "generate", "--line-id", "h1", "--text", "Halo", "--force"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Tts { command: TtsCommand::Generate { force: true, .. }, .. })
        ));
        let cli = Cli::parse_from(["liosvideo", "tts", "sync", "--voice", "v1"]);
        match cli.command {
            Some(Commands::Tts { command: TtsCommand::Sync { script, voice, force }, .. }) => {
                assert_eq!(script, PathBuf::from("script.md"));
                assert_eq!(voice.as_deref(), Some("v1"));
                assert!(!force);
            }
            other => panic!("expected tts sync, got {other:?}"),
        }
    }

    #[test]
    fn parses_render_loudness_options() {
        let cli = Cli::parse_from(["liosvideo", "render", "long.ts", "--loudness", "-16"]);
        match cli.command {
            Some(Commands::Render {
                loudness,
                no_normalize,
                ..
            }) => {
                assert_eq!(loudness, Some(-16.0));
                assert!(!no_normalize);
            }
            _ => panic!("expected render"),
        }
        let cli = Cli::parse_from(["liosvideo", "render", "long.ts", "--no-normalize"]);
        assert!(matches!(
            cli.command,
            Some(Commands::Render {
                no_normalize: true,
                ..
            })
        ));
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
                time: None,
                preset: "native".into(),
            })
        );
    }

    #[test]
    fn parses_image_generation_commands() {
        let cli = Cli::parse_from([
            "liosvideo",
            "asset",
            "generate-image",
            "a palace at night",
            "--id",
            "palace",
            "--aspect",
            "9:16",
            "--ref",
            "assets/images/a.jpg",
            "--ref",
            "assets/images/b.png",
        ]);
        assert_eq!(
            cli.command,
            Some(Commands::Asset {
                command: AssetCommand::GenerateImage {
                    prompt: "a palace at night".into(),
                    id: "palace".into(),
                    aspect: Some("9:16".into()),
                    size: None,
                    model: None,
                    refs: vec!["assets/images/a.jpg".into(), "assets/images/b.png".into()],
                }
            })
        );
        let cli = Cli::parse_from(["liosvideo", "asset", "edit-image", "palace", "darker sky"]);
        assert_eq!(
            cli.command,
            Some(Commands::Asset {
                command: AssetCommand::EditImage {
                    id: "palace".into(),
                    instruction: "darker sky".into(),
                    size: None,
                }
            })
        );
        let cli = Cli::parse_from(["liosvideo", "asset", "use-image", "palace", "1"]);
        assert_eq!(
            cli.command,
            Some(Commands::Asset {
                command: AssetCommand::UseImage {
                    id: "palace".into(),
                    version: 1
                }
            })
        );
    }

    #[test]
    fn parses_verify_command() {
        let cli = Cli::parse_from(["liosvideo", "verify", "out/video.mp4"]);
        assert_eq!(
            cli.command,
            Some(Commands::Verify {
                file: PathBuf::from("out/video.mp4")
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
                        force,
                    },
            }) => {
                assert!(!force);
                assert_eq!(line_id, "l1");
                assert_eq!(text, "hi");
                assert_eq!(voice, None);
            }
            _ => panic!("expected tts generate"),
        }
    }

    #[test]
    fn parses_project_new_with_style_and_styles() {
        let cli = Cli::parse_from([
            "liosvideo",
            "project",
            "new",
            "/tmp",
            "x",
            "--style",
            "comic",
        ]);
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
