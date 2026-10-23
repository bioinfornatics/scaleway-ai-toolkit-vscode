# Django · python
Base backend · SDK agent à intégrer.

Local authoring scaffold. No dependencies installed or code executed during generation.
Review dependency constraints and APIs; no lockfile or installed-framework compatibility certification is supplied.
Backend shells do not implement an agent loop or MCP protocol. Agent SDK mapping to Scaleway, trusted budgets and tool policy remain to integrate; no default provider or fallback.


# Python project layout and offline tests

Delivered: an editable authoring scaffold with a generated Hatchling distribution,
stable src/agent_app import package, configuration parser and local tests.
Generation writes files only; never installs dependencies or executes Python.
Review constraints and APIs before uv sync (editable package and default dev
group) or a separately reviewed pip installation. No lockfile is supplied.

After installation, run python -m pytest -v -p no:cacheprovider.
For source-only checks with available pytest, use
PYTHONPATH=src python -m pytest -v -p no:cacheprovider. This is NOT a wheel build,
installed-package proof or backend/SDK compatibility proof.
Inspect python -m pytest --collect-only -q: default discovery is tests/, not evals/.
Required configuration scenarios (eight cases, not just eight arbitrary passes):

- explicit values and secret-redacted repr;
- import-time environment isolation and explicit call-time loading;
- rejection without value exposure of HTTP, URL userinfo, query, fragment and
  malformed port (five distinct parameter cases);
- explicit empty configuration with no environment fallback.

Tests use synthetic configuration, no SDK, backend, endpoint or model.
load_config reste un parseur sans effet ; load_project_config charge explicitement le .env au lancement.

## Offline installed-package proof (separate, opt-in)

The repository test tests/pythonInstalledLayout.test.cjs is enabled with
SCW_PYTHON_WHEEL_PROOF=1 node --test tests/pythonInstalledLayout.test.cjs from
the extension directory after its separately authorized build. It uses only
available uv cache, uv build --offline, isolated temporary virtualenvs and a
real wheel installed with --no-deps. Imports are checked outside the source
tree using isolated Python without PYTHONPATH; configuration tests run against
that installed package. Missing cached Hatchling/pytest tooling is BLOCKED and
reported as a specific skip, never replaced by a source-path wheel claim.
Runtime dependencies are intentionally NOT installed or imported for this proof.
It proves local package layout, not installed framework compatibility.

## Intégration de votre application
Le backend est une base indépendante. Si un framework IA est sélectionné, son point d’entrée appelle le modèle ; routes, outils et logique métier sont à la charge de votre équipe. Aucun appel réseau pendant la génération.

## Optional evaluation authoring

evals/ is excluded from default pytest discovery. See evals/README.md.
The skeleton skips by default and deliberately FAILS when opted in until reviewed
integration exists. Neither result proves DeepEval compatibility, agent quality,
live integration or rights.
