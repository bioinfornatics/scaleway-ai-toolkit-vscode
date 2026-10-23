use actix_web::{web, HttpResponse};

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.route("/health", web::get().to(|| async { HttpResponse::Ok().body("ok") }));
}
// No listener. Bind loopback explicitly during reviewed manual integration.
