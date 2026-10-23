#!/usr/bin/env bash
# Run an existing local VSIX, with no network uplink or default-profile changes.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
QA=$(mktemp -d /tmp/scw-dedicated-installed.XXXXXX)
VSIX=$1
THEME=$2
SCOPE=$3
export SCALEWAY_DEDICATED_QA_RESULT="$QA/result.json"
export SCALEWAY_DEDICATED_QA_SCOPE="$SCOPE"
mkdir -p "$QA/user/User" "$QA/extensions" "$QA/workspace" "$QA/runner"
printf '%s' '{"security.workspace.trust.enabled":true,"workbench.startupEditor":"none","telemetry.telemetryLevel":"off","update.mode":"none","extensions.autoUpdate":false,"chat.disableAIFeatures":true,"window.dialogStyle":"custom"}' > "$QA/user/User/settings.json"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p));s["workbench.colorTheme"]=process.argv[2];fs.writeFileSync(p,JSON.stringify(s));' "$QA/user/User/settings.json" "$THEME"
printf '%s' '{"name":"isolated-qa-runner","publisher":"local-test","version":"0.0.1","engines":{"vscode":"^1.90.0"},"main":"runner.cjs","activationEvents":["onStartupFinished"],"capabilities":{"untrustedWorkspaces":{"supported":true}}}' > "$QA/runner/package.json"
printf 'exports.activate = () => { require("node:fs").appendFileSync(process.env.SCALEWAY_DEDICATED_QA_RESULT + ".activations", process.pid + String.fromCharCode(10)); if(require("node:fs").existsSync(process.env.SCALEWAY_DEDICATED_QA_RESULT + ".stages"))return; setTimeout(() => require(%s).run().then(() => { require("node:fs").writeFileSync(process.env.SCALEWAY_DEDICATED_QA_RESULT + ".exit", "0"); }).catch(e => { require("node:fs").writeFileSync(process.env.SCALEWAY_DEDICATED_QA_RESULT + ".exit", String(e.stack)); }), 500); };' "\"$ROOT/apps/vscode-extension/tests/dedicatedPlayground-host.cjs\"" > "$QA/runner/runner.cjs"
NATIVE=dedicatedPlayground-native.mjs
if [[ "$SCOPE" == missing ]]; then NATIVE=dedicatedPlayground-missing.mjs; fi
CODE=/usr/share/code/code
# Only loopback is brought up; no external interface/route exists.
unshare -Urn bash -c 'ip link set lo up; exec "$@"' bash env ELECTRON_RUN_AS_NODE=1 "$CODE" /usr/share/code/resources/app/out/cli.js --no-sandbox --shared-data-dir="$QA/shared" --user-data-dir="$QA/user" --extensions-dir="$QA/extensions" --install-extension="$VSIX" --force > "$QA/install.log" 2>&1
sha256sum "$VSIX" > "$QA/package.sha256"
# Seed only this isolated workspace as trusted; revocation uses real VS Code UI.
mkdir -p "$QA/shared/sharedStorage"
python3 -c 'import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]);c.execute("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");c.execute("INSERT OR REPLACE INTO ItemTable VALUES (?,?)",("content.trust.model.key",json.dumps({"uriTrustInfo":[{"uri":{"scheme":"file","path":sys.argv[2]},"trusted":True}]})));c.commit()' "$QA/shared/sharedStorage/state.vscdb" "$QA/workspace"
set +e
unshare -Urn bash -c 'ip link set lo up; "$1" --no-sandbox --remote-debugging-port=9343 --disable-renderer-backgrounding --shared-data-dir="$2/shared" --user-data-dir="$2/user" --extensions-dir="$2/extensions" --extensionDevelopmentPath="$2/runner" --skip-welcome --skip-release-notes --disable-updates --disable-telemetry "$2/workspace" > "$2/host.log" 2>&1 & host=$!; trap "kill -TERM $host 2>/dev/null || true" EXIT; node "$3/apps/vscode-extension/tests/$4" "$2/result.json" "$3" > "$2/native.log" 2>&1; native=$?; for i in {1..20}; do test ! -f "$2/result.json.exit" || break; sleep 1; done; cat "$2/native.log"; if [[ "$4" == dedicatedPlayground-missing.mjs ]]; then test "$native" = 0; else test "$native" = 0 && test "$(cat "$2/result.json.exit" 2>/dev/null)" = 0; fi' bash "$CODE" "$QA" "$ROOT" "$NATIVE"
STATUS=$?
set -e
printf 'QA=%s EXIT=%s RESULT=%s
' "$QA" "$STATUS" "$SCALEWAY_DEDICATED_QA_RESULT"
if (( STATUS != 0 )); then tail -30 "$QA/host.log"; cat "$QA/result.json.exit" 2>/dev/null || true; exit "$STATUS"; fi
node -e 'const r=require(process.argv[1]);if(!r.checks.every(c=>c.passed)||r.physicalCloudRequests!==0)process.exit(1);' "$SCALEWAY_DEDICATED_QA_RESULT"
