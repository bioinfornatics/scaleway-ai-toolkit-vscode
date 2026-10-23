"""Explicit configuration parsing only; environment is not runtime authority."""
from dataclasses import dataclass, field
from collections.abc import Mapping
import os
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AgentConfig:
    endpoint: str
    model_id: str
    key: str = field(repr=False)


def load_config(environ: Mapping[str, str] | None = None) -> AgentConfig:
    """Read env only when called. Never load .env or include values in errors."""
    source = os.environ if environ is None else environ
    values = [source.get(name, "").strip() for name in (
        "SCW_INFERENCE_BASE_URL", "SCW_INFERENCE_MODEL_ID", "SCW_API_KEY"
    )]
    if not all(values):
        raise ValueError("missing external configuration")
    endpoint, model_id, key = values
    try:
        url = urlsplit(endpoint)
        valid = (url.scheme == "https" and bool(url.hostname) and
                 not url.username and not url.password and
                 not url.query and not url.fragment)
        url.port  # Reject malformed ports without exposing endpoint content.
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("invalid endpoint")
    return AgentConfig(endpoint, model_id, key)


def load_project_config():
    """Explicit launch reads only .env in cwd (the documented project root)."""
    from pathlib import Path
    env_file = Path.cwd() / ".env"
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith("#"): continue
            name, value = line.split("=", 1)
            os.environ.setdefault(name.strip(), value.strip().strip(chr(39) + chr(34)))
    return load_config()
