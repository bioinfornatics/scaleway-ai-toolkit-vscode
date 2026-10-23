/* Presentation only: one explicit run intent; no browser transport or secrets. */
const vscode = acquireVsCodeApi();
const panel = document.getElementById('service-playground');
const prompt = document.getElementById('prompt');
const maxTokens = document.getElementById('maxTokens');
const run = document.getElementById('run');
const stop = document.getElementById('stop');
const response = document.getElementById('response');
const status = document.getElementById('status');
const usage = document.getElementById('usage');
const cost = document.getElementById('cost');
const saveExchange = document.getElementById('saveExchange');
const loadSnapshot = document.getElementById('loadSnapshot');
const exportExample = document.getElementById('exportExample');
const actionStatus = document.getElementById('action-status');
let snapshotAvailable = false;
let actionBusy = false;
const permanentlyBlocked = panel.dataset.blocked === 'true';
let ready = false;
let blocked = permanentlyBlocked;
let running = false;
let pending = false;
let latestRunId = -1;
let locallyStopped = false;
let hostLost = false;
let lastHostState = Date.now();

// A webview can survive a Workspace Trust-triggered Extension Host restart.
// Fail closed if the original controller stops acknowledging ready. Never
// reconnect or replay Run automatically; retain visible partial text.
setInterval(() => {
  if (hostLost) return;
  if (Date.now() - lastHostState > 5000) {
    hostLost = true;
    ready = false;
    blocked = true;
    running = false;
    pending = false;
    status.textContent =
      'Session ou extension interrompue · réponse partielle conservée · ouvrez un nouveau playground. La facturation distante peut continuer.';
    updateControls();
    return;
  }
  vscode.postMessage({ type: 'ready' });
}, 1000);

function updateControls() {
  saveExchange.disabled =
    !ready || running || pending || actionBusy || !snapshotAvailable;
  exportExample.disabled = saveExchange.disabled;
  loadSnapshot.disabled = !ready || running || pending || actionBusy;
  run.disabled = !ready || blocked || running || pending || actionBusy;
  stop.disabled = !ready || !(running || pending) || locallyStopped;
  response.setAttribute(
    'aria-busy',
    String((running || pending) && !locallyStopped),
  );
}

function start() {
  if (run.disabled) return;
  const tokens = Number(maxTokens.value);
  if (!prompt.value.trim() || prompt.value.length > 4096) {
    status.textContent = 'Enter a prompt between 1 and 4096 characters.';
    prompt.focus();
    return;
  }
  if (!Number.isInteger(tokens) || tokens < 1 || tokens > 2048) {
    status.textContent =
      'Maximum output tokens must be an integer between 1 and 2048.';
    maxTokens.focus();
    return;
  }
  pending = true;
  locallyStopped = false;
  status.textContent = 'Exécution demandée · un appel facturé…';
  updateControls();
  vscode.postMessage({ type: 'run', prompt: prompt.value, maxTokens: tokens });
}

for (const button of [saveExchange, loadSnapshot, exportExample]) {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    actionBusy = true;
    updateControls();
    vscode.postMessage({ type: button.id });
  });
}
run.addEventListener('click', start);
stop.addEventListener('click', () => {
  if (stop.disabled) return;
  locallyStopped = true;
  status.textContent =
    'Stopped locally. Server-side processing and billing may continue.';
  updateControls();
  vscode.postMessage({ type: 'cancel' });
});
prompt.addEventListener('keydown', (event) => {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key === 'Enter' &&
    !run.disabled
  ) {
    event.preventDefault();
    start();
  }
});

window.addEventListener('message', (event) => {
  if (hostLost) return;
  const message = event.data;
  if (
    message?.type !== 'state' ||
    !Number.isSafeInteger(message.runId) ||
    message.runId < 0 ||
    message.runId < latestRunId ||
    typeof message.running !== 'boolean' ||
    typeof message.blocked !== 'boolean' ||
    typeof message.output !== 'string' ||
    typeof message.status !== 'string'
  )
    return;
  lastHostState = Date.now();
  // A pre-run state must not unlock a pending request or overwrite its output.
  if (pending && message.runId === latestRunId && !message.blocked) return;
  latestRunId = message.runId;
  ready = true;
  pending = false;
  blocked = permanentlyBlocked || message.blocked;
  running = message.running;
  snapshotAvailable = message.snapshotAvailable === true;
  actionBusy = message.actionBusy === true;
  actionStatus.textContent =
    typeof message.actionStatus === 'string' ? message.actionStatus : '';
  if (!locallyStopped || message.blocked) {
    response.textContent = message.output;
    status.textContent = message.status;
    const counts = message.usage;
    const validUsage =
      counts &&
      [counts.inputTokens, counts.outputTokens, counts.totalTokens].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      );
    usage.textContent = validUsage
      ? 'Tokens : ' +
        counts.inputTokens +
        ' input · ' +
        counts.outputTokens +
        ' output · ' +
        counts.totalTokens +
        ' total tokens'
      : 'Tokens : indisponible';
    cost.textContent =
      typeof message.cost === 'string' && message.cost.trim()
        ? 'Coût : ' + message.cost
        : 'Coût : indisponible';
  }
  if (permanentlyBlocked)
    status.textContent = 'Blocked: unsupported service. No demo substitute.';
  updateControls();
});
updateControls();
vscode.postMessage({ type: 'ready' });
