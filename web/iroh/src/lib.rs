//! A browser's Iroh endpoint, for the app on its own origin (`web/src/lib/browser-shell.ts`): the same device the
//! phone's shell is (DESIGN.md "Clients"), where no native code runs. A browser sends no UDP, so it reaches the daemon
//! through a relay alone, end-to-end encrypted. The crate carries bytes only: one bi-stream an exchange, the request
//! written whole, the response read as it comes. HTTP is framed in the app (`iroh-http.ts`).

use std::str::FromStr;

use iroh::{
    Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl, SecretKey,
    defaults::prod,
    endpoint::{Connection, RecvStream, SendStream, presets},
};
use iroh_tickets::endpoint::EndpointTicket;
use js_sys::Uint8Array;
use n0_future::stream;
use wasm_bindgen::prelude::*;
use wasm_streams::{ReadableStream, readable::sys::ReadableStream as JsReadableStream};

/// The one protocol the daemon's endpoint speaks (`src/server/remote.ts`).
const ALPN: &[u8] = b"banda/0";

/// The most read from a stream at once.
const CHUNK: usize = 64 * 1024;

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();
}

fn failed(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

/// A relay's URL without the dot iroh ends its host name with: WebKit refuses the relay's certificate for a name
/// written with one, so a page in Safari would reach no relay at all.
fn undotted(url: &RelayUrl) -> Result<RelayUrl, JsError> {
    let text = url.to_string();
    let (scheme, rest) = text.split_once("://").ok_or_else(|| failed("not a URL"))?;
    let (host, tail) = rest.split_at(rest.find(['/', ':']).unwrap_or(rest.len()));
    format!("{scheme}://{}{tail}", host.trim_end_matches('.'))
        .parse()
        .map_err(failed)
}

/// The endpoint id of the daemon a ticket names.
#[wasm_bindgen]
pub fn computer(ticket: String) -> Result<String, JsError> {
    let ticket = EndpointTicket::from_str(&ticket).map_err(failed)?;
    Ok(ticket.endpoint_addr().id.to_string())
}

/// This browser as a device: its endpoint, bound with the device's key.
#[wasm_bindgen]
pub struct Device {
    endpoint: Endpoint,
}

#[wasm_bindgen]
impl Device {
    /// Bind an endpoint with `secret`, the device's key: 32 bytes the app made and keeps.
    pub async fn create(secret: Vec<u8>) -> Result<Device, JsError> {
        let secret: [u8; 32] = secret.try_into().map_err(|_| failed("a key is 32 bytes"))?;
        let relays = [
            prod::NA_EAST_RELAY_HOSTNAME,
            prod::NA_WEST_RELAY_HOSTNAME,
            prod::EU_RELAY_HOSTNAME,
            prod::AP_RELAY_HOSTNAME,
        ]
        .map(|host| format!("https://{}", host.trim_end_matches('.')));
        let relays = RelayMap::try_from_iter(relays.iter().map(String::as_str)).map_err(failed)?;
        let endpoint = Endpoint::builder(presets::N0)
            .relay_mode(RelayMode::Custom(relays))
            .secret_key(SecretKey::from_bytes(&secret))
            .bind()
            .await
            .map_err(failed)?;
        Ok(Device { endpoint })
    }

    /// This device's endpoint id: what the daemon knows it by.
    pub fn id(&self) -> String {
        self.endpoint.id().to_string()
    }

    /// Dial the daemon a ticket names. The connection is the caller's to keep and to close: the endpoint keeps
    /// none, so a dial that ends late can never take the place of the one the app is using.
    pub async fn dial(&self, ticket: String) -> Result<Daemon, JsError> {
        let ticket = EndpointTicket::from_str(&ticket).map_err(failed)?;
        // a browser reaches a relay alone: the daemon's own addresses are of no use to it
        let mut addr = EndpointAddr::new(ticket.endpoint_addr().id);
        for relay in ticket.endpoint_addr().relay_urls() {
            addr = addr.with_relay_url(undotted(relay)?);
        }
        let connection = self.endpoint.connect(addr, ALPN).await.map_err(failed)?;
        Ok(Daemon { connection })
    }

    /// Close the endpoint, and every connection with it.
    pub async fn close(&self) {
        self.endpoint.close().await;
    }
}

/// A connection to one daemon, authenticated as the endpoint its ticket named.
#[wasm_bindgen]
pub struct Daemon {
    connection: Connection,
}

#[wasm_bindgen]
impl Daemon {
    /// The endpoint id of the daemon at the other end.
    pub fn id(&self) -> String {
        self.connection.remote_id().to_string()
    }

    /// A bi-stream of its own on the connection, with nothing sent yet. It fails when the connection has gone, which
    /// is the one failure that is safe to dial again for: no request was written.
    pub async fn open(&self) -> Result<Exchange, JsError> {
        let (send, recv) = self.connection.open_bi().await.map_err(failed)?;
        Ok(Exchange { send, recv })
    }

    /// Close the connection: every stream on it ends.
    pub fn close(&self) {
        self.connection.close(0u8.into(), b"closing");
    }
}

/// One exchange with the daemon: a stream opened, its request not yet written.
#[wasm_bindgen]
pub struct Exchange {
    send: SendStream,
    recv: RecvStream,
}

#[wasm_bindgen]
impl Exchange {
    /// Write `request` whole and finish, then the response's bytes as they come, until the daemon ends the stream.
    /// Cancelling the stream stops the daemon's side.
    pub async fn send(self, request: Vec<u8>) -> Result<JsReadableStream, JsError> {
        let Exchange { mut send, recv } = self;
        send.write_all(&request).await.map_err(failed)?;
        send.finish().map_err(failed)?;
        let body = stream::unfold(recv, |mut recv| async move {
            match recv.read_chunk(CHUNK).await {
                Ok(Some(chunk)) => {
                    Some((Ok(JsValue::from(Uint8Array::from(chunk.as_ref()))), recv))
                }
                Ok(None) => None,
                Err(error) => Some((Err(JsValue::from(failed(error))), recv)),
            }
        });
        Ok(ReadableStream::from_stream(body).into_raw())
    }
}
