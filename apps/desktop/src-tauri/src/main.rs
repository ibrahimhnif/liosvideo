// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "--mcp-bridge" {
        let port = args.get(2).and_then(|p| p.parse::<u16>().ok());
        match port {
            Some(port) => {
                if let Err(e) = desktop_lib::mcp::bridge::run_bridge(port) {
                    eprintln!("mcp bridge error: {e}");
                    std::process::exit(1);
                }
                std::process::exit(0);
            }
            None => {
                eprintln!("Usage: {} --mcp-bridge <port>", args.first().map(String::as_str).unwrap_or("desktop"));
                std::process::exit(1);
            }
        }
    }

    desktop_lib::run()
}
