use clap::{CommandFactory, Parser};
#[path = "lib.rs"]
mod scaffold;

#[derive(Parser)]
#[command(disable_help_flag = true, about = "Local authoring CLI shell; no AI loop integrated")]
struct Args {
    /// Show this help and exit
    #[arg(long, short)]
    help: bool,
    /// Check the CLI shell only; no inference, dependency proof or server binding
    #[arg(long)]
    check: bool,
    /// Start the reviewed backend explicitly (never an AI agent loop)
    #[arg(long)]
    serve: bool,
    #[arg(long, default_value = "127.0.0.1")]
    host: std::net::IpAddr,
    #[arg(long, default_value_t = 3000, value_parser = clap::value_parser!(u16).range(1..))]
    port: u16,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    if args.help { Args::command().print_help()?; println!(); return Ok(()); }
    if args.check { println!("CLI shell valid; dependencies and runtime integration not verified. No network or server."); return Ok(()); }
    if !args.serve { println!("Pass --serve explicitly after reviewing authentication."); return Ok(()); }
    actix_web::rt::System::new().block_on(async {
        actix_web::HttpServer::new(|| actix_web::App::new().configure(scaffold::configure))
            .bind((args.host, args.port))?.run().await?;
        Ok(())
    })
}
