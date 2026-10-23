(() => {
  const api = acquireVsCodeApi();
  const main = document.querySelector('main');
  if (!main) return;
  for (const button of main.querySelectorAll('button[data-action]')) {
    button.addEventListener('click', () => {
      const type = button.dataset.action;
      if (
        type === 'catalog' ||
        type === 'refresh'
      ) {
        api.postMessage({ type, token: main.dataset.token });
      } else if (type === 'open') {
        api.postMessage({
          type,
          kind: button.dataset.kind,
          id: button.dataset.id,
          token: main.dataset.token,
        });
      }
    });
  }
})();
