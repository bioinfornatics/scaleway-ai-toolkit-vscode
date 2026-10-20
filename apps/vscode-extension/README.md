# Scaleway AI Toolkit — Preview 0.0.7

Experimental community VS Code extension; no Scaleway affiliation. **User browser
login without API keys**, scoped read-only projects/dedicated deployments and a
separate **offline synthetic** playground. No real inference or cloud writes.

## Install and try

    code --install-extension artifacts/scaleway-ai-toolkit-preview-0.0.7.vsix --force

Reload Window, then **Scaleway AI: Open Offline Preview** (legacy command name).

1. Mes ressources -> **Projet : sélectionner**, or **Se connecter à Scaleway**.
2. Confirm browser opening. Sign in on **account.scaleway.com**, not inside VS Code.
3. The browser returns the user JWT automatically to a temporary local callback.
   Return to VS Code; no token/password/key to copy or paste.
4. Enter the UUID of the organization you authorize for project reads. This is
   scope metadata, not a credential. Confirm up to 5 GET, then select a project.
5. Charger les modèles lists existing dedicated deployments of that project in
   **fr-par**, after a separate confirmation (up to 5 GET). No inference.

The UUID is still necessary to bound reads; automatic organization discovery is
not implemented. Browser credentials/MFA stay on Scaleway. The extension neither
creates an API key nor imports old keys. Successful login/disconnect deletes the
legacy preview API-key SecretStorage entry and connection metadata.

## Session and transport

Source-backed mechanism: Scaleway CLI login uses
https://account.scaleway.com/authenticate with redirectToUrl, receiving a Base64
JSON envelope with token/jwt/renewToken. We omit its subsequent CreateAPIKey step.
The SDK maps user JWT to **X-Session-Token**, not X-Auth-Token or Bearer for control
APIs. References and pinned hashes: evidence/documentation/scaleway-user-login-v1.json.
This is called **Scaleway user login**, not a verified OAuth authorization-code/
PKCE integration. No undocumented OAuth parameters or renewal endpoint invented.

JWT is retained **only in extension-host memory**, never in files, globalState,
SecretStorage, logs, webview, or chat. renewToken and browser metadata are discarded.
Shape and expiry are checked locally, not signature authenticity: the Scaleway API
validates authenticity and IAM on each request. Expiry is the earlier of JWT exp
and envelope expiresAt; session drops 30s before expiry. Reconnect after expiry,
Reload Window or extension restart. Disconnect clears the local session and cancels
pending work; it does **not** revoke the token or sign out of Scaleway in the browser.

Callback: IPv4 loopback only, OS-selected port, localhost redirect, random 192-bit
path correlation inside redirectToUrl, exact path/Host/peer/method, no Origin or
request body, bounded headers/query, one successful consumption, 3-minute timeout,
cancel and cleanup. No callback query/token logging. Success page has no-store,
no-referrer and nonce CSP and replaces the credential URL in browser history.
The provider's acceptance of the randomized localhost callback path remains to
be verified live; this is not a provider-verified state/PKCE guarantee. Like the
CLI flow, token arrives in a URL; localhost processes and browser machinery are
part of the trust boundary. Invalid callbacks do not consume the pending login.

**Local desktop VS Code only for browser login in this preview.** Remote SSH,
WSL, Containers and Codespaces hosts are blocked rather than opening an unusable
remote loopback callback. Workspace Trust required. Startup and tree navigation
make no API requests. A connected user session is not automatically permission
to run inference or mutate resources.

Control GET uses fixed api.scaleway.com routes, no retries/redirects/proxy env,
10s request deadline, 2MiB response limit, max5 sequential pages per collection.
No response body/header/error details logged; safe error codes only. A 401/403
drops the local session; check IAM/organization and reconnect, no key fallback.
Local minimum projections are not full production wire-schema validation.

**Serverless JWT audience/header support is not established.** This preview sends
no JWT to api.scaleway.ai and displays that limitation explicitly. No project/model
API acceptance has been verified with a real user account yet. Dedicated entries
are deployments, not the dedicated model catalog. Clicking a real entry shows
information only; **real models cannot run in this playground yet**.

## Offline playground

Mes ressources -> Démonstration hors ligne -> choose a synthetic model.
Outils de développement -> Construire et tester -> **Playground modèle**.
Enter prompt, Exécuter/Ctrl+Enter; Arrêter preserves partial output. Open experiment
JSON and save only if desired. Closing the panel cancels the demo. No prompt/output
automatically saved, no credentials passed to the webview, no API usage/billing.

## Build and verification

    cd apps/vscode-extension
    npm ci --ignore-scripts
    npm run package

Private package; no Marketplace/npm publication, tag or push. Tests use synthetic
JWTs, mocked VS Code/provider and real loopback HTTP callbacks. Passing tests do
not establish real Scaleway sign-in, callback acceptance or API compatibility.
User test needed: browser login -> automatic return -> scoped projects -> dedicated
reads -> disconnect. Do not share token, callback URL, passwords or cookies.
Next increment depends on this real-account feedback and establishing JWT model
access; no API-key substitution. Production/design/value gates remain separate.

## Brand asset notice

Scaleway mark comes from official website favicon assets. Rights remain with
Scaleway; local experimental identification only, not endorsement. Publication
requires separate brand review. ai-PULSE event branding not used. Asset provenance:
evidence/documentation/scaleway-icon-preview-v1.json.
