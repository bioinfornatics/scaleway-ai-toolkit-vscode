#!/usr/bin/env python3
"""CI-only registry bootstrap; never runs a generated application or inference.

Read the checked-in mandatory Rust template manifests as data (not source code).
Resolve their declared ranges once online, log the resulting lock, then compile
only our inert fixture offline/locked. Optional Actix inventories remain outside
this bootstrap. No local runtime/project dependency installation is introduced.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib

APP = Path(__file__).resolve().parents[2]
EXPECTED = {
    "none": {"clap": {"version": "4.5", "features": ["derive"]}},
    "axum": {
        "axum": "0.8",
        "tokio": {"version": "1", "features": ["full"]},
        "clap": {"version": "4.5", "features": ["derive"]},
    },
}


def prepare(destination):
    # Fail on dependency drift rather than downloading newly added PR dependencies.
    for category in ("agents", "tools"):
        for backend, expected in EXPECTED.items():
            source = APP / "assets/templates" / category / "rust" / backend / "files/Cargo.toml"
            data = tomllib.loads(source.read_text())
            if data.get("dependencies") != expected or set(data) != {"package", "dependencies"}:
                raise ValueError(f"Unreviewed Rust dependency inventory: {source}")
    destination.mkdir(parents=True, exist_ok=True)
    dependencies = EXPECTED["axum"]
    lines = ['[package]', 'name = "scw-ci-dependency-proof"', 'version = "0.0.0"', 'edition = "2021"', '', '[dependencies]']
    for name, declaration in dependencies.items():
        if isinstance(declaration, str):
            value = json.dumps(declaration)
        else:
            value = '{ version = ' + json.dumps(declaration['version']) + ', features = ' + json.dumps(declaration['features']) + ' }'
        lines.append(name + ' = ' + value)
    manifest = destination / "Cargo.toml"
    manifest.write_text("\n".join(lines) + "\n")
    (destination / "src").mkdir()
    (destination / "src/lib.rs").write_text('#[derive(clap::Parser)]\npub struct CompileOnly {}\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", type=Path, help="write inert fixture only; no commands/network")
    args = parser.parse_args()
    if args.prepare_only:
        print(prepare(args.prepare_only))
        return
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("CARGO_NET_OFFLINE") != "false":
        raise SystemExit("Bootstrap requires GitHub Actions and its explicit network-only step environment")
    with tempfile.TemporaryDirectory(prefix="scw-ci-rust-", dir=os.environ["RUNNER_TEMP"]) as tmp:
        manifest = prepare(Path(tmp))
        print(manifest.read_text(), flush=True)
        subprocess.run(["cargo", "fetch", "--manifest-path", str(manifest)], check=True)
        # Record concrete resolved versions; later offline resolution uses this warmed registry.
        print((manifest.parent / "Cargo.lock").read_text(), flush=True)
        subprocess.run(["cargo", "build", "--offline", "--locked", "--all-targets", "--manifest-path", str(manifest)], check=True, env={**os.environ, "CARGO_NET_OFFLINE": "true"})


if __name__ == "__main__":
    main()
