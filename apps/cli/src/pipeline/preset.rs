// Export presets matching the desktop Export dialog.

use anyhow::{anyhow, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preset {
    Native,
    P1080,
    P4k,
    Shorts,
    /// 720p (short side 720) at a low bitrate, for sending and reviewing
    Preview,
    TikTok,
    Reels,
    /// 1920x1080 (a vertical composition goes up as a 1080x1920 Short)
    YouTube,
}

pub const PRESET_NAMES: &str = "native, 1080p, 4k, shorts, preview, tiktok, reels, youtube";

impl Preset {
    pub fn parse(value: &str) -> Result<Self> {
        match value.to_ascii_lowercase().as_str() {
            "native" => Ok(Self::Native),
            "1080p" => Ok(Self::P1080),
            "4k" | "2160p" => Ok(Self::P4k),
            "shorts" | "vertical" => Ok(Self::Shorts),
            "preview" | "review" => Ok(Self::Preview),
            "tiktok" => Ok(Self::TikTok),
            "reels" | "instagram" => Ok(Self::Reels),
            "youtube" => Ok(Self::YouTube),
            other => Err(anyhow!("Unknown preset '{other}' (expected {PRESET_NAMES})")),
        }
    }

    pub fn size(&self, width: u32, height: u32) -> (u32, u32) {
        match self {
            Self::Native => (width, height),
            Self::P1080 => (1920, 1080),
            Self::P4k => (3840, 2160),
            Self::Shorts | Self::TikTok | Self::Reels => (1080, 1920),
            Self::YouTube if height > width => (1080, 1920),
            Self::YouTube => (1920, 1080),
            Self::Preview => {
                // 720p: the short side is 720 (never scaled up)
                let short = width.min(height).max(1) as f64;
                let k = (720.0 / short).min(1.0);
                let even = |v: f64| ((v / 2.0).round() as u32 * 2).max(2);
                (even(width as f64 * k), even(height as f64 * k))
            }
        }
    }

    /// H.264 bits per second (`--quality` / `--bitrate` override it).
    pub fn default_bitrate(&self) -> u32 {
        match self {
            Self::P4k => 30_000_000,
            Self::Preview => 600_000,
            Self::YouTube => 12_000_000,
            _ => 10_000_000,
        }
    }

    /// AAC bits per second (`--audio-bitrate` overrides it).
    pub fn audio_bitrate(&self) -> u32 {
        match self {
            Self::Preview => 96_000,
            Self::YouTube => 320_000,
            _ => 192_000,
        }
    }
}

pub fn quality_bitrate(quality: &str) -> Option<u32> {
    match quality.to_ascii_lowercase().as_str() {
        "low" => Some(4_000_000),
        "medium" => Some(10_000_000),
        "high" => Some(30_000_000),
        _ => None,
    }
}

pub fn resolve_bitrate(explicit: Option<u32>, quality: Option<&str>, preset: Preset) -> u32 {
    explicit
        .or_else(|| quality.and_then(quality_bitrate))
        .unwrap_or_else(|| preset.default_bitrate())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_sizes_match_desktop() {
        assert_eq!(Preset::P1080.size(1080, 1920), (1920, 1080));
        assert_eq!(Preset::P4k.size(1080, 1920), (3840, 2160));
        assert_eq!(Preset::Shorts.size(1920, 1080), (1080, 1920));
        assert_eq!(Preset::Native.size(1000, 500), (1000, 500));
    }

    #[test]
    fn preview_is_720p_and_small() {
        assert_eq!(Preset::Preview.size(1080, 1920), (720, 1280));
        assert_eq!(Preset::Preview.size(1920, 1080), (1280, 720));
        assert_eq!(Preset::Preview.size(1000, 1000), (720, 720));
        assert_eq!(Preset::Preview.size(1366, 768), (1280, 720));
        assert_eq!(Preset::Preview.size(640, 360), (640, 360));
        // a 60 s video at these rates is about 5 MB
        let bytes = (Preset::Preview.default_bitrate() + Preset::Preview.audio_bitrate()) as f64 * 60.0 / 8.0;
        assert!(bytes < 6_000_000.0, "{bytes}");
    }

    #[test]
    fn platform_presets() {
        for p in [Preset::TikTok, Preset::Reels] {
            assert_eq!(p.size(1920, 1080), (1080, 1920));
        }
        assert_eq!(Preset::YouTube.size(3840, 2160), (1920, 1080));
        assert_eq!(Preset::YouTube.size(1080, 1920), (1080, 1920)); // vertical goes up as a Short
        assert_eq!(Preset::YouTube.default_bitrate(), 12_000_000);
        assert_eq!(Preset::YouTube.audio_bitrate(), 320_000);
        assert_eq!(Preset::parse("TikTok").unwrap(), Preset::TikTok);
        assert_eq!(Preset::parse("instagram").unwrap(), Preset::Reels);
        assert!(Preset::parse("vimeo").unwrap_err().to_string().contains("preview"));
    }

    #[test]
    fn bitrate_priority() {
        assert_eq!(resolve_bitrate(Some(1), Some("high"), Preset::P4k), 1);
        assert_eq!(resolve_bitrate(None, Some("high"), Preset::P4k), 30_000_000);
        assert_eq!(resolve_bitrate(None, None, Preset::P4k), 30_000_000);
        assert_eq!(resolve_bitrate(None, None, Preset::P1080), 10_000_000);
    }
}
