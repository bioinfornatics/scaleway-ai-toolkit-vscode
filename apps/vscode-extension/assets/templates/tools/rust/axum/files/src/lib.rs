use axum::{routing::get, Router};

pub fn application() -> Router {
    Router::new().route("/health", get(|| async { "ok" }))
}
// No listener. Bind loopback explicitly during reviewed manual integration.
