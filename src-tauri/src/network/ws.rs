use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::error::{AppError, AppResult};

/// Start a loopback-only WebSocket proxy that bridges noVNC to the QEMU VNC port.
///
/// Security properties:
/// * listener binds to 127.0.0.1 only
/// * every connection must present the per-session token
/// * no file serving, no directory listing, no other routes
pub async fn start_proxy(vnc_port: u16, token: String) -> AppResult<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let ws_port = listener.local_addr()?.port();
    let token = Arc::new(token);

    tokio::spawn(async move {
        loop {
            let (stream, peer) = match listener.accept().await {
                Ok(v) => v,
                Err(_) => break,
            };
            if !peer.ip().is_loopback() {
                continue;
            }
            let token = token.clone();
            tokio::spawn(async move {
                let _ = handle_connection(stream, vnc_port, token).await;
            });
        }
    });

    Ok(ws_port)
}

async fn handle_connection(
    stream: TcpStream,
    vnc_port: u16,
    token: Arc<String>,
) -> AppResult<()> {
    let expected = token.clone();
    let ws = tokio_tungstenite::accept_hdr_async(
        stream,
        move |req: &Request, mut resp: Response| -> Result<Response, ErrorResponse> {
            let query = req.uri().query().unwrap_or("");
            let supplied = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("token="))
                .unwrap_or("");
            if supplied != expected.as_str() {
                let mut err = ErrorResponse::new(Some("unauthorized".to_string()));
                *err.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
                return Err(err);
            }
            resp.headers_mut().insert(
                "Sec-WebSocket-Protocol",
                HeaderValue::from_static("binary"),
            );
            Ok(resp)
        },
    )
    .await
    .map_err(|e| AppError::protocol(format!("websocket handshake failed: {e}")))?;

    let vnc = TcpStream::connect(("127.0.0.1", vnc_port))
        .await
        .map_err(|e| AppError::protocol(format!("VNC connection failed: {e}")))?;
    vnc.set_nodelay(true).ok();

    let (mut ws_tx, mut ws_rx) = ws.split();
    let (mut vnc_rx, mut vnc_tx) = vnc.into_split();

    let client_to_vnc = tokio::spawn(async move {
        while let Some(msg) = ws_rx.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    if vnc_tx.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = vnc_tx.shutdown().await;
    });

    let vnc_to_client = tokio::spawn(async move {
        let mut buf = vec![0u8; 32 * 1024];
        loop {
            match vnc_rx.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if ws_tx.send(Message::Binary(buf[..n].to_vec())).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = ws_tx.close().await;
    });

    let _ = tokio::try_join!(client_to_vnc, vnc_to_client);
    Ok(())
}
