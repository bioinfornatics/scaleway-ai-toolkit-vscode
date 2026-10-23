use clap::{CommandFactory, Parser};

#[derive(Parser)]
#[command(disable_help_flag = true, about = "Local authoring CLI shell; no AI loop integrated")]
struct Args {
    /// Show this help and exit
    #[arg(long, short)]
    help: bool,
    /// Check the CLI shell only; no inference, dependency proof or server binding
    #[arg(long)]
    check: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    if args.help { Args::command().print_help()?; println!(); return Ok(()); }
    if args.check { println!("CLI shell valid; dependencies and runtime integration not verified. No network or server."); return Ok(()); }
    println!("Authoring shell only; use the library during reviewed integration.");
    Ok(())
}
