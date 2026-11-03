// Session identity and screen lock.
//
// OneOS runs as the signed-in Windows user, so the shell has the same rights as
// that account (no separate "guest" login). What the shell adds is a *screen
// lock*: an optional PIN that protects the desktop when the user steps away.
//
// The PIN is never stored in clear text. A random 16-byte salt is generated once
// and `SHA-256(salt || ":" || pin)` is persisted in the settings table. Five bad
// attempts trigger a 30 second cool-down.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::db::Store;
use crate::error::{AppError, AppResult};

const KEY_USER: &str = "session.user";
const KEY_SALT: &str = "session.pin.salt";
const KEY_HASH: &str = "session.pin.hash";
const KEY_LOCK_ON_START: &str = "session.lock_on_start";

const MAX_FAILURES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(30);

/// (consecutive failures, locked-out-until)
static THROTTLE: Mutex<(u32, Option<Instant>)> = Mutex::new((0, None));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// Display name shown on the login and lock screens.
    pub user: String,
    /// Local Windows account that actually owns this process.
    pub host_user: String,
    pub pin_set: bool,
    pub lock_on_start: bool,
}

pub fn default_user() -> String {
    std::env::var("USERNAME")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "Owner".to_string())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    out
}

fn random_salt() -> String {
    let mut raw = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut raw);
    hex(&raw)
}

fn digest(salt: &str, pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":");
    hasher.update(pin.as_bytes());
    hex(&hasher.finalize())
}

/// Constant-time comparison so a wrong PIN cannot be found byte by byte.
fn equals(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn pin_is_set(all: &std::collections::BTreeMap<String, String>) -> bool {
    all.get(KEY_HASH).map(|h| !h.is_empty()).unwrap_or(false)
}

pub fn info(store: &Store) -> AppResult<SessionInfo> {
    let all = store.settings_all()?;
    Ok(SessionInfo {
        user: all
            .get(KEY_USER)
            .filter(|v| !v.trim().is_empty())
            .map(|v| v.trim().to_string())
            .unwrap_or_else(default_user),
        host_user: default_user(),
        pin_set: pin_is_set(&all),
        lock_on_start: all.get(KEY_LOCK_ON_START).map(|v| v == "true").unwrap_or(false),
    })
}

pub fn set_user(store: &Store, name: &str) -> AppResult<SessionInfo> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("the display name cannot be empty"));
    }
    if name.chars().count() > 32 {
        return Err(AppError::validation("the display name is too long (32 characters max)"));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c == '.')
    {
        return Err(AppError::validation(
            "use letters, digits, spaces, dots, dashes or underscores",
        ));
    }
    store.setting_set(KEY_USER, name)?;
    info(store)
}

pub fn set_lock_on_start(store: &Store, enabled: bool) -> AppResult<SessionInfo> {
    store.setting_set(KEY_LOCK_ON_START, if enabled { "true" } else { "false" })?;
    info(store)
}

/// Create, change or remove (new = None) the PIN. Changing or removing an
/// existing PIN requires the current one.
pub fn set_pin(store: &Store, current: Option<&str>, new: Option<&str>) -> AppResult<SessionInfo> {
    let all = store.settings_all()?;
    if pin_is_set(&all) {
        let supplied = current.unwrap_or("");
        let salt = all.get(KEY_SALT).cloned().unwrap_or_default();
        let expected = all.get(KEY_HASH).cloned().unwrap_or_default();
        if !equals(&digest(&salt, supplied), &expected) {
            return Err(AppError::validation("the current PIN is incorrect"));
        }
    }

    match new {
        Some(pin) => {
            let len = pin.chars().count();
            if len < 4 || len > 64 {
                return Err(AppError::validation("the PIN must be 4 to 64 characters"));
            }
            if pin.trim().is_empty() {
                return Err(AppError::validation("the PIN cannot be blank"));
            }
            let salt = random_salt();
            store.setting_set(KEY_SALT, &salt)?;
            store.setting_set(KEY_HASH, &digest(&salt, pin))?;
        }
        None => {
            store.setting_set(KEY_SALT, "")?;
            store.setting_set(KEY_HASH, "")?;
        }
    }
    reset_throttle();
    info(store)
}

fn reset_throttle() {
    if let Ok(mut t) = THROTTLE.lock() {
        *t = (0, None);
    }
}

/// Returns `true` when the PIN matches. Errors carry the cool-down message so the
/// UI can show it verbatim.
pub fn verify(store: &Store, pin: &str) -> AppResult<bool> {
    if let Ok(t) = THROTTLE.lock() {
        if let Some(until) = t.1 {
            let now = Instant::now();
            if now < until {
                let left = (until - now).as_secs() + 1;
                return Err(AppError::validation(format!(
                    "too many attempts, try again in {left}s"
                )));
            }
        }
    }

    let all = store.settings_all()?;
    let ok = if pin_is_set(&all) {
        let salt = all.get(KEY_SALT).cloned().unwrap_or_default();
        let expected = all.get(KEY_HASH).cloned().unwrap_or_default();
        equals(&digest(&salt, pin), &expected)
    } else {
        false
    };

    if let Ok(mut t) = THROTTLE.lock() {
        if ok {
            *t = (0, None);
        } else {
            t.0 += 1;
            if t.0 >= MAX_FAILURES {
                *t = (0, Some(Instant::now() + LOCKOUT));
            }
        }
    }
    Ok(ok)
}
