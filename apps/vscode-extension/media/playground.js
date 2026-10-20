/* Presentation only: no provider transport, credentials or HTML from output. */
const vscode = acquireVsCodeApi();
const model = document.getElementById('model');
const prompt = document.getElementById('prompt');
const run = document.getElementById('run');
const stop = document.getElementById('stop');
const experiment = document.getElementById('experiment');
const response = document.getElementById('response');
const status = document.getElementById('status');
run.addEventListener('click', () => {
  if (!prompt.value.trim()) {
    prompt.focus();
    status.textContent = 'Saisissez une instruction.';
    return;
  }
  vscode.postMessage({ type: 'run', model: model.value, prompt: prompt.value });
});
stop.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
experiment.addEventListener('click', () =>
  vscode.postMessage({ type: 'experiment' }),
);
prompt.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !run.disabled) {
    e.preventDefault();
    run.click();
  }
});
window.addEventListener('message', (e) => {
  const message = e.data;
  if (message.type === 'state') {
    model.value = message.model;
    if (typeof message.prompt === 'string') prompt.value = message.prompt;
    run.disabled = message.running;
    stop.disabled = !message.running;
    model.disabled = message.running;
    prompt.disabled = message.running;
    experiment.disabled = !message.hasExperiment;
    response.textContent = message.output;
    status.textContent = message.status;
    response.setAttribute('aria-busy', String(message.running));
  }
});
vscode.postMessage({ type: 'ready' });
