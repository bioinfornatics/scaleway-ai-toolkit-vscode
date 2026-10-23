(() => {
  const api = acquireVsCodeApi();
  const token = document.body.dataset.token;
  const create = document.querySelector('button[data-action="create"]');
  create?.addEventListener('click', () =>
    api.postMessage({ action: 'create', token }),
  );
})();
