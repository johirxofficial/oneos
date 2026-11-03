use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::vm::config::VmConfig;

/// Current schema version. Increment together with a new migration step.
const SCHEMA_VERSION: i64 = 1;

/// SQLite-backed application store.
///
/// Only application state lives here: preferences, VM definition, snapshot
/// metadata. The guest file system never does - it stays inside the QCOW2 image.
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self { conn: Mutex::new(conn) };
        store.migrate()?;
        store.seed_defaults()?;
        Ok(store)
    }

    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::internal("database lock poisoned"))?;
        let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current >= SCHEMA_VERSION {
            return Ok(());
        }
        if current < 1 {
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS settings (
                    key         TEXT PRIMARY KEY,
                    value       TEXT NOT NULL,
                    updated_at  INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS vms (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL,
                    spec_json   TEXT NOT NULL,
                    created_at  INTEGER NOT NULL,
                    updated_at  INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS snapshots (
                    id          TEXT PRIMARY KEY,
                    vm_id       TEXT NOT NULL,
                    name        TEXT NOT NULL,
                    path        TEXT NOT NULL,
                    created_at  INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_events (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts          INTEGER NOT NULL,
                    level       TEXT NOT NULL,
                    source      TEXT NOT NULL,
                    message     TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_app_events_ts ON app_events(ts DESC);
                "#,
            )?;
            conn.pragma_update(None, "user_version", 1)?;
        }
        Ok(())
    }

    fn seed_defaults(&self) -> AppResult<()> {
        let defaults: [(&str, &str); 10] = [
            ("theme", "aurora"),
            ("wallpaper", "nebula"),
            ("accent", "#4f9dff"),
            ("startup.behavior", "ask"),
            ("shutdown.behavior", "powerdown"),
            ("boot.splash", "true"),
            ("display.width", "1280"),
            ("display.height", "720"),
            ("vm.memory_mb", "1536"),
            ("vm.cpu_cores", "2"),
        ];
        let conn = self.conn.lock().map_err(|_| AppError::internal("database lock poisoned"))?;
        let now = now_ts();
        for (k, v) in defaults {
            conn.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO NOTHING",
                params![k, v, now],
            )?;
        }
        Ok(())
    }

    pub fn settings_all(&self) -> AppResult<BTreeMap<String, String>> {
        let conn = self.conn.lock().map_err(|_| AppError::internal("database lock poisoned"))?;
        let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut out = BTreeMap::new();
        for row in rows {
            let (k, v) = row?;
            out.insert(k, v);
        }
        Ok(out)
    }

    pub fn setting_get(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().map_err(|_| AppError::internal("database lock poisoned"))?;
        let value = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
                r.get::<_, String>(0)
            })
            .optional()?;
        Ok(value)
    }

    pub fn setting_set(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::internal("database lock poisoned"))?;
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now_ts()],
        )?;
        Ok(())
    }

    pub fn save_vm(&self, cfg: &VmConfig) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::internal("database lock poisoned"))?;
        let spec = serde_json::to_string(cfg)?;
        let now = now_ts();
        conn.execute(
            "INSERT INTO vms (id, name, spec_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, spec_json = excluded.spec_json, updated_at = excluded.updated_at",
            params![cfg.id, cfg.name, spec, now],
        )?;
        Ok(())
    }

    pub fn load_vm(&self) -> AppResult<Option<VmConfig>> {
        let conn = self.conn.lock().map_err(|_| AppError::internal("database lock poisoned"))?;
        let spec = conn
            .query_row(
                "SELECT spec_json FROM vms ORDER BY updated_at DESC LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        match spec {
            Some(s) => Ok(Some(serde_json::from_str(&s)?)),
            None => Ok(None),
        }
    }

    pub fn log_event(&self, level: &str, source: &str, message: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::internal("database lock poisoned"))?;
        conn.execute(
            "INSERT INTO app_events (ts, level, source, message) VALUES (?1, ?2, ?3, ?4)",
            params![now_ts(), level, source, message],
        )?;
        Ok(())
    }
}

pub fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
