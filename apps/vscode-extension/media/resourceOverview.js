(() => {
  const api = acquireVsCodeApi();
  const main = document.querySelector('main');
  if (!main) return;
  const token = main.dataset.token;
  const states = [];
  const opaque = (value, length) =>
    typeof value === 'string' &&
    new RegExp('^[a-f0-9]{' + length + '}$').test(value);
  const hide = (state) => {
    state.request = undefined;
    state.shown = false;
    state.input.value = state.mask;
    state.button.setAttribute('aria-pressed', 'false');
    state.button.setAttribute('aria-label', 'Afficher ' + state.label);
    state.button.setAttribute('title', 'Afficher ' + state.label);
    state.input.setAttribute('aria-label', state.label + ' masquée');
  };
  const hideAll = () => {
    for (const state of states) hide(state);
  };
  for (const button of main.querySelectorAll('button[data-action]')) {
    const type = button.dataset.action;
    if (type === 'reveal-key') {
      const id = button.dataset.id;
      const field = button.dataset.field;
      const input = button.parentElement?.querySelector('input');
      if (
        !input ||
        !opaque(id, 32) ||
        !opaque(token, 48) ||
        (field !== 'access' && field !== 'secret')
      )
        continue;
      const state = {
        button,
        input,
        id,
        field,
        mask: input.value,
        label: field === 'access' ? 'la clé API' : 'la clé secrète',
        shown: false,
        request: undefined,
      };
      states.push(state);
      button.addEventListener('click', () => {
        if (state.shown || state.request) {
          hide(state);
          return;
        }
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        state.request = Array.from(bytes, (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', 'Masquer ' + state.label);
        button.setAttribute('title', 'Masquer ' + state.label);
        api.postMessage({ type, id, field, request: state.request, token });
      });
      continue;
    }
    button.addEventListener('click', () => {
      hideAll();
      if (type === 'catalog' || type === 'refresh' || type === 'add-key') {
        api.postMessage({ type, token });
      } else if (type === 'import-key' || type === 'use-key') {
        api.postMessage({ type, id: button.dataset.id, token });
      } else if (type === 'open') {
        api.postMessage({
          type,
          kind: button.dataset.kind,
          id: button.dataset.id,
          token,
        });
      }
    });
  }
  window.addEventListener('message', (event) => {
    const row = event.data;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const success = row.type === 'reveal-key-success';
    if (
      (!success && row.type !== 'reveal-key-error') ||
      Object.keys(row).length !== (success ? 6 : 5) ||
      row.token !== token ||
      !opaque(row.token, 48) ||
      !opaque(row.id, 32) ||
      !opaque(row.request, 32) ||
      (row.field !== 'access' && row.field !== 'secret')
    )
      return;
    if (
      success &&
      (typeof row.value !== 'string' ||
        !(
          row.field === 'access'
            ? /^SCW[A-Z0-9]{17}$/
            : /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
        ).test(row.value))
    )
      return;
    const state = states.find(
      (entry) =>
        entry.id === row.id &&
        entry.field === row.field &&
        entry.request === row.request,
    );
    if (!state) return;
    if (!success || document.hidden) {
      hide(state);
      return;
    }
    state.request = undefined;
    state.shown = true;
    state.input.value = row.value;
    state.input.setAttribute('aria-label', state.label + ' affichée');
  });
  window.addEventListener('blur', hideAll);
  window.addEventListener('pagehide', hideAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideAll();
  });
})();
