// Port of packages/runtime/src/math/color.ts (parseColor).
// Keeps the same non-linear (sRGB-encoded) 0..1 semantics used by the desktop renderer.

pub type Rgba = [f32; 4];

pub fn parse_color(hex: &str) -> Result<Rgba, String> {
    let mut h = hex.trim();
    if let Some(stripped) = h.strip_prefix('#') {
        h = stripped;
    }

    let expanded;
    if h.len() == 3 || h.len() == 4 {
        expanded = h.chars().flat_map(|c| [c, c]).collect::<String>();
        h = &expanded;
    }

    let owned;
    if h.len() == 6 {
        owned = format!("{h}ff");
        h = &owned;
    }

    if h.len() != 8 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("Invalid color \"{hex}\""));
    }

    let channel = |start: usize| -> f32 {
        u8::from_str_radix(&h[start..start + 2], 16).unwrap_or(0) as f32 / 255.0
    };

    Ok([channel(0), channel(2), channel(4), channel(6)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_hex_forms() {
        assert_eq!(parse_color("#fff").unwrap(), [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(parse_color("#0000").unwrap(), [0.0, 0.0, 0.0, 0.0]);
        assert_eq!(parse_color("#ff0000").unwrap(), [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(
            parse_color("00ff0080").unwrap(),
            [0.0, 1.0, 0.0, 128.0 / 255.0]
        );
    }

    #[test]
    fn rejects_invalid() {
        assert!(parse_color("#12").is_err());
        assert!(parse_color("nope").is_err());
    }
}
