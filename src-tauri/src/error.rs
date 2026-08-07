//! Structured command errors.
//!
//! Every Tauri command returns `Result<T, CommandError>` so the frontend can
//! distinguish protocol-level signals (e.g. cancellation, segment mismatch)
//! from user-facing failures without string matching.

use serde::Serialize;

/// Stable error codes exposed to the frontend.
pub mod code {
    pub const CANCELLED: &str = "CANCELLED";
    pub const SEGMENT_COUNT_MISMATCH: &str = "SEGMENT_COUNT_MISMATCH";
    pub const SKIP_OWN_CONTENT: &str = "SKIP_OWN_CONTENT";
    pub const VALIDATION: &str = "VALIDATION";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const IO: &str = "IO";
    pub const API: &str = "API";
    pub const INTERNAL: &str = "INTERNAL";
}

/// Structured error returned by Tauri commands.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn cancelled() -> Self {
        Self::new(code::CANCELLED, "请求已取消")
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(code::VALIDATION, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(code::NOT_FOUND, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(code::IO, message)
    }

    pub fn api(message: impl Into<String>) -> Self {
        Self::new(code::API, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(code::INTERNAL, message)
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CommandError {}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        Self::internal(message)
    }
}

impl From<rusqlite::Error> for CommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self::io(error.to_string())
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self::io(error.to_string())
    }
}
