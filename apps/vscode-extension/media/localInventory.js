(() => {
  const vscode = acquireVsCodeApi();
  const token = document.body.dataset.token;
  for (const button of document.querySelectorAll('button[data-action]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'create' || action === 'refresh') {
        vscode.postMessage({ action, token });
      } else if (
        ['open', 'run', 'configure', 'stop', 'logs', 'remove'].includes(
          action,
        ) &&
        /^[a-f0-9]{32}$/.test(button.dataset.id || '')
      ) {
        vscode.postMessage({ action, token, id: button.dataset.id });
      }
    });
  }
})();
