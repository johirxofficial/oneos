use serde::{Serialize, Serializer};

/// Application-wide error type. Every command returns `Result<T, AppError>` so that
/// the frontend receives a stable, human-readable message instead of a panic.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("QEMU is not available: {0}")]
    QemuMissing(String),

    #[error("invalid configuration: {0}")]
    Validation(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("protocol error: {0}")]
    Protocol(String),

    #[error("guest agent error: {0}")]
    Guest(String),

    #[error("not supported: {0}")]
    Unsupported(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::Validation(msg.into())
    }

    pub fn protocol(msg: impl Into<String>) -> Self {
        Self::Protocol(msg.into())
    }

    pub fn guest(msg: impl Into<String>) -> Self {
        Self::Guest(msg.into())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }
}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self::Validation(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self::Validation(value.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
