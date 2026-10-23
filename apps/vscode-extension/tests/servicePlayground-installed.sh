#!/usr/bin/env bash
# Run an existing local VSIX, with no network uplink or default-profile changes.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
QA=$(mktemp -d /tmp/scw-playground-installed.XXXXXX)
VSIX=$1
THEME=$2
SCOPE=$3
export SCALEWAY_PLAYGROUND_QA_RESULT="$QA/result.json"
export SCALEWAY_PLAYGROUND_QA_SCOPE="$SCOPE"
mkdir -p "$QA/user/User" "$QA/extensions" "$QA/workspace" "$QA/runner"
printf '%s' '{"security.workspace.trust.enabled":true,"workbench.startupEditor":"none","telemetry.telemetryLevel":"off","update.mode":"none","extensions.autoUpdate":false,"chat.disableAIFeatures":true}' > "$QA/user/User/settings.json"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p));s["workbench.colorTheme"]=process.argv[2];fs.writeFileSync(p,JSON.stringify(s));' "$QA/user/User/settings.json" "$THEME"
printf '%s' '{"name":"isolated-qa-runner","publisher":"local-test","version":"0.0.1","engines":{"vscode":"^1.90.0"},"main":"runner.cjs","activationEvents":["onStartupFinished"],"capabilities":{"untrustedWorkspaces":{"supported":true}}}' > "$QA/runner/package.json"
printf 'exports.activate = () => { if(require("node:fs").existsSync(process.env.SCALEWAY_PLAYGROUND_QA_RESULT + ".stages"))return; setTimeout(() => require(%s).run().then(() => { require("node:fs").writeFileSync(process.env.SCALEWAY_PLAYGROUND_QA_RESULT + ".exit", "0"); }).catch(e => { require("node:fs").writeFileSync(process.env.SCALEWAY_PLAYGROUND_QA_RESULT + ".exit", String(e.stack)); }), 500); };' "\"$ROOT/apps/vscode-extension/tests/servicePlayground-host.cjs\"" > "$QA/runner/runner.cjs"
CODE=/usr/share/code/code
# Only loopback is brought up; no external interface/route exists.
unshare -Urn bash -c 'ip link set lo up; exec "$@"' bash env ELECTRON_RUN_AS_NODE=1 "$CODE" /usr/share/code/resources/app/out/cli.js --no-sandbox --shared-data-dir="$QA/shared" --user-data-dir="$QA/user" --extensions-dir="$QA/extensions" --install-extension="$VSIX" --force > "$QA/install.log" 2>&1
sha256sum "$VSIX" > "$QA/package.sha256"
# Seed only this isolated workspace as trusted; revocation uses real VS Code UI.
mkdir -p "$QA/shared/sharedStorage"
python3 -c 'import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]);c.execute("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");c.execute("INSERT OR REPLACE INTO ItemTable VALUES (?,?)",("content.trust.model.key",json.dumps({"uriTrustInfo":[{"uri":{"scheme":"file","path":sys.argv[2]},"trusted":True}]})));c.commit()' "$QA/shared/sharedStorage/state.vscdb" "$QA/workspace"
set +e
unshare -Urn bash -c 'ip link set lo up; exec "$@"' bash timeout 180s "$CODE" --no-sandbox --remote-debugging-port=9338 --disable-renderer-backgrounding --shared-data-dir="$QA/shared" --user-data-dir="$QA/user" --extensions-dir="$QA/extensions" --extensionDevelopmentPath="$QA/runner" --skip-welcome --skip-release-notes --disable-updates --disable-telemetry "$QA/workspace" > "$QA/host.log" 2>&1 &
HOST=$!
trap 'kill -TERM "$HOST" 2>/dev/null || true' EXIT
for ((i=0;i<160;i++)); do
  [[ ! -f "$SCALEWAY_PLAYGROUND_QA_RESULT.exit" ]] || break
  kill -0 "$HOST" 2>/dev/null || break
  sleep 1
done
STATUS=1
if [[ -f "$SCALEWAY_PLAYGROUND_QA_RESULT.exit" ]] && [[ $(cat "$SCALEWAY_PLAYGROUND_QA_RESULT.exit") == 0 ]]; then STATUS=0; fi
set -e
printf 'QA=%s EXIT=%s RESULT=%s
' "$QA" "$STATUS" "$SCALEWAY_PLAYGROUND_QA_RESULT"
if (( STATUS != 0 )); then tail -30 "$QA/host.log"; exit "$STATUS"; fi
node -e 'const r=require(process.argv[1]);if(!r.checks.every(c=>c.passed)||r.physicalCloudRequests!==0)process.exit(1);' "$SCALEWAY_PLAYGROUND_QA_RESULT"
