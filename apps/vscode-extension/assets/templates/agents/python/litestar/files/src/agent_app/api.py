from litestar import Litestar, get

@get("/health", sync_to_thread=False)
def health() -> dict[str, str]:
    return {"status": "ok"}

app = Litestar(route_handlers=[health], debug=False)
# No launch on import. Use the explicit argparse CLI.
