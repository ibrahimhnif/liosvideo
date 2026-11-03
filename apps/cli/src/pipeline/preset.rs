// Export presets matching the desktop Export dialog.

use anyhow::{anyhow, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preset {
    Native,
    P1080,
    P4k,
    Shorts,
}

impl Preset {
    pub fn parse(value: &str) -> Result<Self> {
        match value.to_ascii_lowercase().as_str() {
            "native" => Ok(Self::Native),
            "1080p" => Ok(Self::P1080),
            "4k" | "2160p" => Ok(Self::P4k),
            "shorts" | "vertical" => Ok(Self::Shorts),
            other => Err(anyhow!(
                "Unknown preset '{other}' (expected native, 1080p, 4k, or shorts)"
            )),
        }
    }

    pub fn size(&self, width: u32, height: u32) -> (u32, u32) {
        match self {
            Self::Native => (width, height),
            Self::P1080 => (1920, 1080),
            Self::P4k => (3840, 2160),
            Self::Shorts => (1080, 1920),
        }
    }

    pub fn default_bitrate(&self) -> u32 {
        match self {
            Self::P4k => 30_000_000,
            _ => 10_000_000,
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
    fn bitrate_priority() {
        assert_eq!(resolve_bitrate(Some(1), Some("high"), Preset::P4k), 1);
        assert_eq!(resolve_bitrate(None, Some("high"), Preset::P4k), 30_000_000);
        assert_eq!(resolve_bitrate(None, None, Preset::P4k), 30_000_000);
        assert_eq!(resolve_bitrate(None, None, Preset::P1080), 10_000_000);
    }
}
