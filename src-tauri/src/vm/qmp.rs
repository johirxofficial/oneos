use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

use crate::error::{AppError, AppResult};

/// QEMU Machine Protocol client.
///
/// Bound to a loopback TCP port that QEMU creates for this VM only. QMP is
/// never exposed on a non-loopback interface.
pub struct QmpClient {
    reader: BufReader<tokio::net::tcp::OwnedReadHalf>,
    writer: tokio::net::tcp::OwnedWriteHalf,
}

impl QmpClient {
    /// Connect with retries, because QEMU needs a moment to open the socket.
    pub async fn connect(port: u16, total_timeout: Duration) -> AppResult<Self> {
        let deadline = tokio::time::Instant::now() + total_timeout;
        loop {
            match TcpStream::connect(("127.0.0.1", port)).await {
                Ok(stream) => {
                    stream.set_nodelay(true).ok();
                    let (read, write) = stream.into_split();
                    return Ok(Self { reader: BufReader::new(read), writer: write });
                }
                Err(_) if tokio::time::Instant::now() < deadline => {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                }
                Err(e) => {
                    return Err(AppError::protocol(format!(
                        "could not connect to QMP on 127.0.0.1:{port}: {e}"
                    )))
                }
            }
        }
    }

    async fn read_value(&mut self) -> AppResult<Value> {
        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(Duration::from_secs(20), self.reader.read_line(&mut line))
                .await
                .map_err(|_| AppError::protocol("timed out waiting for QMP response"))??;
            if n == 0 {
                return Err(AppError::protocol("QMP connection closed"));
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(trimmed) {
                Ok(v) => return Ok(v),
                Err(_) => continue,
            }
        }
    }

    pub async fn handshake(&mut self) -> AppResult<()> {
        let greeting = self.read_value().await?;
        if greeting.get("QMP").is_none() {
            return Err(AppError::protocol("unexpected QMP greeting"));
        }
        // QEMU answers a no-data command with `{"return": {}}`, so any successful
        // reply means the capabilities negotiation completed.
        self.execute("qmp_capabilities", None).await?;
        Ok(())
    }

    pub async fn execute(&mut self, command: &str, args: Option<Value>) -> AppResult<Value> {
        let request = match args {
            Some(a) => json!({ "execute": command, "arguments": a }),
            None => json!({ "execute": command }),
        };
        let mut payload = serde_json::to_vec(&request)?;
        payload.push(b'\n');
        self.writer.write_all(&payload).await?;
        self.writer.flush().await?;

        loop {
            let value = self.read_value().await?;
            if let Some(err) = value.get("error") {
                let desc = err
                    .get("desc")
                    .and_then(|d| d.as_str())
                    .unwrap_or("unknown QMP error");
                return Err(AppError::protocol(format!("{command} failed: {desc}")));
            }
            if let Some(ret) = value.get("return") {
                return Ok(ret.clone());
            }
            // Any other object is an asynchronous event; ignore it.
        }
    }

    pub async fn set_vnc_password(&mut self, password: &str) -> AppResult<()> {
        // `set_password` has no result payload; a successful reply is `{}`.
        self.execute(
            "set_password",
            Some(json!({ "protocol": "vnc", "password": password })),
        )
        .await
        .map(|_| ())
    }

    pub async fn powerdown(&mut self) -> AppResult<()> {
        self.execute("system_powerdown", None).await.map(|_| ())
    }

    pub async fn quit(&mut self) -> AppResult<()> {
        // `quit` may close the socket before replying.
        let request = json!({ "execute": "quit" });
        let mut payload = serde_json::to_vec(&request)?;
        payload.push(b'\n');
        let _ = self.writer.write_all(&payload).await;
        let _ = self.writer.flush().await;
        Ok(())
    }

    pub async fn status(&mut self) -> AppResult<String> {
        let v = self.execute("query-status", None).await?;
        Ok(v.get("status").and_then(|s| s.as_str()).unwrap_or("unknown").to_string())
    }
}

/// Result of a command executed inside the guest.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[cfg(windows)]
pub struct GuestAgent {
    pipe: BufReader<tokio::net::TcpStream>,
}

#[cfg(windows)]
impl GuestAgent {
    /// Connect to the loopback guest-agent channel for a VM, retrying until the
    /// guest agent inside the guest answers.
    pub async fn connect(port: u16, total_timeout: Duration) -> AppResult<Self> {
        let deadline = tokio::time::Instant::now() + total_timeout;
        loop {
            match tokio::net::TcpStream::connect(("127.0.0.1", port)).await {
                Ok(stream) => {
                    stream.set_nodelay(true).ok();
                    return Ok(Self {
                        pipe: BufReader::new(stream),
                    });
                }
                Err(_) if tokio::time::Instant::now() < deadline => {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                Err(e) => {
                    return Err(AppError::guest(format!(
                        "could not open guest agent channel on 127.0.0.1:{port}: {e}"
                    )))
                }
            }
        }
    }

    pub async fn call(&mut self, command: &str, args: Option<Value>) -> AppResult<Value> {
        let request = match args {
            Some(a) => json!({ "execute": command, "arguments": a }),
            None => json!({ "execute": command }),
        };
        let mut payload = serde_json::to_vec(&request)?;
        payload.push(b'\n');
        self.pipe.write_all(&payload).await?;
        self.pipe.flush().await?;

        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(Duration::from_secs(30), self.pipe.read_line(&mut line))
                .await
                .map_err(|_| AppError::guest("guest agent did not answer in time"))??;
            if n == 0 {
                return Err(AppError::guest("guest agent channel closed"));
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(trimmed)?;
            if let Some(err) = value.get("error") {
                let desc = err
                    .get("desc")
                    .and_then(|d| d.as_str())
                    .unwrap_or("guest agent error");
                return Err(AppError::guest(desc.to_string()));
            }
            if let Some(ret) = value.get("return") {
                return Ok(ret.clone());
            }
        }
    }

    pub async fn ping(&mut self) -> AppResult<()> {
        self.call("guest-ping", None).await.map(|_| ())
    }

    /// Flush replies that a timed-out call left behind.
    ///
    /// The guest-agent protocol is a single ordered pipe, so one call that
    /// exceeds its deadline leaves its answer queued: the next request would
    /// read that stale answer instead of its own. `guest-sync` is the protocol's
    /// own reset — the agent discards pending output and echoes the id back.
    pub async fn resync(&mut self, id: u64) -> AppResult<()> {
        let request = json!({ "execute": "guest-sync", "arguments": { "id": id } });
        let mut payload = serde_json::to_vec(&request)?;
        payload.push(b'\n');
        self.pipe.write_all(&payload).await?;
        self.pipe.flush().await?;
        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(Duration::from_secs(5), self.pipe.read_line(&mut line))
                .await
                .map_err(|_| AppError::guest("guest agent did not answer in time"))??;
            if n == 0 {
                return Err(AppError::guest("guest agent channel closed"));
            }
            let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if value.get("return").and_then(|v| v.as_u64()) == Some(id) {
                return Ok(());
            }
        }
    }

    /// Run a shell command inside the guest and capture its output.
    pub async fn exec(&mut self, script: &str, timeout: Duration) -> AppResult<ExecResult> {
        let started = self
            .call(
                "guest-exec",
                Some(json!({
                    "path": "/bin/sh",
                    "arg": ["-c", script],
                    "capture-output": true
                })),
            )
            .await?;

        let pid = started
            .get("pid")
            .and_then(|p| p.as_i64())
            .ok_or_else(|| AppError::guest("guest-exec did not return a pid"))?;

        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let status = self.call("guest-exec-status", Some(json!({ "pid": pid }))).await?;
            let exited = status.get("exited").and_then(|e| e.as_bool()).unwrap_or(false);
            if exited {
                let exit_code = status.get("exitcode").and_then(|c| c.as_i64()).unwrap_or(-1) as i32;
                return Ok(ExecResult {
                    exit_code,
                    stdout: decode_b64_field(&status, "out-data"),
                    stderr: decode_b64_field(&status, "err-data"),
                });
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(AppError::guest("guest command timed out"));
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }
    }

    pub async fn file_open(&mut self, path: &str, mode: &str) -> AppResult<i64> {
        let v = self
            .call("guest-file-open", Some(json!({ "path": path, "mode": mode })))
            .await?;
        v.as_i64().ok_or_else(|| AppError::guest("guest-file-open returned no handle"))
    }

    pub async fn file_read(&mut self, handle: i64, count: usize) -> AppResult<(Vec<u8>, bool)> {
        let v = self
            .call(
                "guest-file-read",
                Some(json!({ "handle": handle, "count": count })),
            )
            .await?;
        let eof = v.get("eof").and_then(|e| e.as_bool()).unwrap_or(true);
        let data = v
            .get("buf-b64")
            .and_then(|d| d.as_str())
            .map(base64_decode)
            .transpose()?
            .unwrap_or_default();
        Ok((data, eof))
    }

    pub async fn file_write(&mut self, handle: i64, bytes: &[u8]) -> AppResult<usize> {
        let encoded = base64_encode(bytes);
        let v = self
            .call(
                "guest-file-write",
                Some(json!({ "handle": handle, "buf-b64": encoded })),
            )
            .await?;
        Ok(v.get("count").and_then(|c| c.as_u64()).unwrap_or(0) as usize)
    }

    pub async fn file_close(&mut self, handle: i64) -> AppResult<()> {
        self.call("guest-file-close", Some(json!({ "handle": handle }))).await.map(|_| ())
    }

    pub async fn fsinfo(&mut self) -> AppResult<Value> {
        self.call("guest-get-fsinfo", None).await
    }

    pub async fn osinfo(&mut self) -> AppResult<Value> {
        self.call("guest-get-osinfo", None).await
    }
}

#[cfg(not(windows))]
pub struct GuestAgent;

#[cfg(not(windows))]
impl GuestAgent {
    pub async fn connect(_pipe_name: &str, _total_timeout: Duration) -> AppResult<Self> {
        Err(AppError::Unsupported("guest agent is only implemented on Windows hosts".into()))
    }
}

fn decode_b64_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .and_then(|s| base64_decode(s).ok())
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}

// Minimal base64 implementation so the backend has no extra dependency.
const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(B64_ALPHABET[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            B64_ALPHABET[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64_ALPHABET[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

pub fn base64_decode(input: &str) -> AppResult<Vec<u8>> {
    let cleaned: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if cleaned.len() % 4 != 0 {
        return Err(AppError::internal("invalid base64 payload length"));
    }
    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    for chunk in cleaned.chunks(4) {
        let mut vals = [0u32; 4];
        let mut pad = 0;
        for (i, &c) in chunk.iter().enumerate() {
            if c == b'=' {
                pad += 1;
                vals[i] = 0;
            } else {
                let idx = B64_ALPHABET
                    .iter()
                    .position(|&x| x == c)
                    .ok_or_else(|| AppError::internal("invalid base64 character"))?;
                vals[i] = idx as u32;
            }
        }
        let n = (vals[0] << 18) | (vals[1] << 12) | (vals[2] << 6) | vals[3];
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
}
