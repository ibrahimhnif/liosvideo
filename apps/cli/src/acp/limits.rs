//! Classifies agent failures that a different model or agent can recover from.
//!
//! ACP agents report these differently (RPC errors, stderr lines, `stopReason`s), so matching is
//! deliberately conservative and always keeps the raw message for the user.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LimitKind {
    UsageLimit,
    Auth,
    ModelUnavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitInfo {
    pub kind: LimitKind,
    pub message: String,
    pub reset_hint: Option<String>,
}

const MODEL_MARKERS: [&str; 5] = [
    "model not found",
    "no access to model",
    "model is not available",
    "unsupported model",
    "unknown model",
];

const AUTH_MARKERS: [&str; 7] = [
    "authentication required",
    "not authenticated",
    "unauthorized",
    "invalid api key",
    "invalid x-api-key",
    "token expired",
    "log in again",
];

const USAGE_MARKERS: [&str; 10] = [
    "rate limit",
    "rate-limit",
    "usage limit",
    "weekly limit",
    "session limit",
    "quota",
    "too many requests",
    "out of credits",
    "insufficient credit",
    "credit balance",
];

fn has(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

/// `Some` when the failure is a usage limit, auth problem or missing model.
pub fn detect(message: &str) -> Option<LimitInfo> {
    let lower = message.to_lowercase();
    let kind = if has(&lower, &MODEL_MARKERS) {
        LimitKind::ModelUnavailable
    } else if has(&lower, &AUTH_MARKERS) || lower.contains("401") {
        LimitKind::Auth
    } else if has(&lower, &USAGE_MARKERS)
        || lower.contains("429")
        || (lower.contains("hit your") && lower.contains("limit"))
        || lower.contains("limit reached")
    {
        LimitKind::UsageLimit
    } else {
        return None;
    };

    Some(LimitInfo {
        kind,
        message: message.trim().to_string(),
        reset_hint: reset_hint(message),
    })
}

/// Pulls "resets 5pm", "resets at 17:00" or "retry in 20 minutes" out of the message.
fn reset_hint(message: &str) -> Option<String> {
    let lower = message.to_lowercase();
    for marker in ["resets at ", "resets ", "reset at ", "retry in ", "retry after "] {
        if let Some(start) = lower.find(marker) {
            let tail = &message[start..];
            let line = tail.lines().next().unwrap_or(tail).trim();
            let cut = line
                .find(['.', ',', ';'])
                .map(|i| &line[..i])
                .unwrap_or(line)
                .trim();
            if !cut.is_empty() && cut.len() <= 80 {
                return Some(cut.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_anthropic_style_limits_with_reset_hint() {
        let info = detect("You've hit your 5-hour limit · resets 5pm (Asia/Jakarta)").unwrap();
        assert_eq!(info.kind, LimitKind::UsageLimit);
        assert_eq!(info.reset_hint.as_deref(), Some("resets 5pm (Asia/Jakarta)"));
    }

    #[test]
    fn detects_rate_limit_api_errors() {
        let info = detect("Claude API rate limit reached. Try again later.").unwrap();
        assert_eq!(info.kind, LimitKind::UsageLimit);
        assert!(detect("429 Too Many Requests").is_some());
        assert!(detect("quota exceeded for this billing period").is_some());
    }

    #[test]
    fn detects_auth_and_model_failures() {
        assert_eq!(detect("Authentication required").unwrap().kind, LimitKind::Auth);
        assert_eq!(detect("401 Unauthorized").unwrap().kind, LimitKind::Auth);
        assert_eq!(
            detect("model not found: gpt-9").unwrap().kind,
            LimitKind::ModelUnavailable
        );
    }

    #[test]
    fn ignores_unrelated_failures() {
        assert!(detect("The agent exited").is_none());
        assert!(detect("failed to compile scenes/intro.ts").is_none());
        assert!(detect("network timeout").is_none());
    }

    #[test]
    fn parses_retry_hints() {
        let info = detect("usage limit reached, retry in 20 minutes").unwrap();
        assert_eq!(info.reset_hint.as_deref(), Some("retry in 20 minutes"));
    }
}
