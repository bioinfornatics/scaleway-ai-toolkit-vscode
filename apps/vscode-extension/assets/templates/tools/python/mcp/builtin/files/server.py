from mcp.server.fastmcp import FastMCP

mcp = FastMCP("reviewed-example")

@mcp.tool()
def add(left: int, right: int) -> int:
    """Add two integers without external effects."""
    return left + right

# No launch entry point: transport and authentication require review.
