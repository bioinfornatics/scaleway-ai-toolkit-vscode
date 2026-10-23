(() => {
  const vscode = acquireVsCodeApi();
  const token = document.body.dataset.token;
  const focusActions = new Set([
    'webapp',
    'agentService',
    'cliExposure',
    'apiExposure',
    'nextFrontend',
    'viteFrontend',
    'integratedBackend',
    'separateBackend',

    'chooseStack',
    'chooseTemplate',
    'language',
    'backend',
    'ai',
    'key',
    'model',
    'stack',
    'destination',
    'projectPath',
    'serverless',
    'dedicated',
    'preview',
    'create',
    'refresh',
  ]);
  const requestedFocus = document.body.dataset.focusAction;
  if (focusActions.has(requestedFocus)) {
    const control = document.querySelector?.(
      '[data-action="' + requestedFocus + '"]',
    );
    const target =
      requestedFocus === 'preview'
        ? (document.querySelector?.('button[data-selected-template="true"]') ??
          control)
        : control;
    if (target && !target.disabled && !target.closest?.('[hidden]'))
      target.focus?.({ preventScroll: true });
  }
  const actions = new Set([
    'webapp',
    'agentService',
    'cliExposure',
    'apiExposure',
    'nextFrontend',
    'viteFrontend',
    'integratedBackend',
    'separateBackend',

    'chooseStack',
    'chooseTemplate',
    'destination',
    'addKey',
    'serverless',
    'dedicated',
    'refresh',
    'new',
    'import',
    'saveDraft',
    'preview',
    'language',
    'stack',
    'create',
    'edit',
  ]);
  let modelRevision = 0;
  let lastModelRefresh = 0;
  const refreshModelList = () => {
    const now = Date.now();
    if (now - lastModelRefresh < 1000) return;
    lastModelRefresh = now;
    vscode.postMessage({ action: 'refreshModels', token });
  };
  window.addEventListener('message', (event) => {
    const value = event.data;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        (value.keys !== undefined
          ? 'keys,models,revision,selected,selectedKey,token,type'
          : 'models,revision,selected,token,type') ||
      value.type !== 'creation-models' ||
      typeof value.selected !== 'string' ||
      (value.selected !== '' && !/^[a-f0-9]{32}$/.test(value.selected)) ||
      value.token !== token ||
      !Number.isSafeInteger(value.revision) ||
      value.revision <= modelRevision ||
      !Array.isArray(value.models) ||
      value.models.length > 256 ||
      value.models.some(
        (m) =>
          !m ||
          typeof m !== 'object' ||
          Object.keys(m).sort().join(',') !== 'index,label' ||
          !/^[a-f0-9]{32}$/.test(m.index) ||
          typeof m.label !== 'string' ||
          m.label.length > 1024,
      )
    )
      return;
    if (
      value.keys !== undefined &&
      (!Array.isArray(value.keys) ||
        value.keys.length > 500 ||
        value.keys.some(
          (key) =>
            !key ||
            typeof key !== 'object' ||
            Object.keys(key).sort().join(',') !== 'index,label' ||
            !/^[a-f0-9]{32}$/.test(key.index) ||
            typeof key.label !== 'string' ||
            key.label.length > 1024,
        ) ||
        typeof value.selectedKey !== 'string' ||
        (value.selectedKey !== '' && !/^[a-f0-9]{32}$/.test(value.selectedKey)))
    )
      return;
    const keySelect = document.querySelector?.('select[data-action="key"]');
    if (keySelect && value.keys) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = value.keys.length
        ? 'Sélectionner une clé API locale'
        : 'Aucune clé locale valide';
      keySelect.replaceChildren(
        placeholder,
        ...value.keys.map((key) => {
          const option = document.createElement('option');
          option.value = key.index;
          option.textContent = key.label;
          return option;
        }),
      );
      keySelect.value = value.keys.some(
        (key) => key.index === value.selectedKey,
      )
        ? value.selectedKey
        : '';
    }
    const select = document.querySelector('select[data-action="model"]');
    if (!select) return;
    modelRevision = value.revision;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = value.models.length
      ? select.dataset.placeholder
      : select.dataset.empty;
    const options = value.models.map((m) => {
      const option = document.createElement('option');
      option.value = m.index;
      option.textContent = m.label;
      return option;
    });
    select.replaceChildren(placeholder, ...options);
    select.value = value.models.some((m) => m.index === value.selected)
      ? value.selected
      : '';
    const create = document.querySelector('button[data-agent-create]');
    const name = document.querySelector('input[data-action="name"]');
    if (create) {
      const ready =
        create.dataset.stackReady !== 'false' &&
        (!!select.value || !!document.querySelector('.template-notice')) &&
        create.dataset.destinationReady !== 'false' &&
        (!keySelect || !!keySelect.value);
      create.dataset.keyReady = String(!keySelect || !!keySelect.value);
      create.dataset.ready = String(ready);
      create.disabled =
        !ready || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name?.value ?? '');
    }
  });
  document.addEventListener('keydown', (event) => {
    const radio = event.target.closest('button[role="radio"]');
    if (
      radio?.getAttribute?.('role') === 'radio' &&
      !radio.disabled &&
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
      ].includes(event.key)
    ) {
      const group = radio.closest('[role="radiogroup"]');
      const choices = Array.from(
        group.querySelectorAll('button[role="radio"]'),
      );
      const position = choices.indexOf(radio);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? choices.length - 1
            : (position +
                (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) +
                choices.length) %
              choices.length;
      event.preventDefault();
      vscode.postMessage({ action: choices[next].dataset.action, token });
      return;
    }
    const tab = event.target.closest('button[role="tab"]');
    if (
      tab &&
      !tab.disabled &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    ) {
      const action =
        event.key === 'Home'
          ? 'chooseStack'
          : event.key === 'End'
            ? 'chooseTemplate'
            : tab.dataset.action === 'chooseStack'
              ? 'chooseTemplate'
              : 'chooseStack';
      event.preventDefault();
      vscode.postMessage({ action, token });
      return;
    }
    if (
      ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) &&
      (event.target.closest('select[data-action="model"]') ||
        event.target.closest('select[data-action="key"]'))
    )
      refreshModelList();
  });
  document.addEventListener('input', (event) => {
    const pathField = event.target.closest('input[data-action="projectPath"]');
    if (pathField) {
      if (pathField.dataset) pathField.dataset.edited = 'true';
      vscode.postMessage({
        action: 'projectPath',
        token,
        path: pathField.value,
      });
      const create = document.querySelector?.('button[data-agent-create]');
      if (create) {
        create.dataset.destinationReady = String(!!pathField.value);
        const name = document.querySelector?.('input[data-action="name"]');
        const model = document.querySelector?.('select[data-action="model"]');
        create.dataset.ready = String(
          create.dataset.stackReady !== 'false' &&
            !!pathField.value &&
            create.dataset.keyReady !== 'false' &&
            (!!model?.value || !!document.querySelector?.('.template-notice')),
        );
        create.disabled =
          create.dataset.ready !== 'true' ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name?.value ?? '');
      }
      return;
    }
    const field = event.target.closest('input[data-action="name"]');
    if (!field) return;
    const valid =
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(field.value) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(field.value);
    const projectPath = document.querySelector?.(
      'input[data-action="projectPath"]',
    );
    if (projectPath && valid) {
      if (projectPath.dataset) projectPath.dataset.edited = 'false';
      const base = projectPath.dataset?.base ?? '';
      projectPath.value = base
        ? base.replace(/\/+$/, '') + '/' + field.value
        : field.value;
      const create = document.querySelector?.('button[data-agent-create]');
      if (create) {
        create.dataset.destinationReady = String(!!projectPath.value);
        const model = document.querySelector?.('select[data-action="model"]');
        create.dataset.ready = String(
          create.dataset.stackReady !== 'false' &&
            !!projectPath.value &&
            create.dataset.keyReady !== 'false' &&
            (!!model?.value || !!document.querySelector?.('.template-notice')),
        );
      }
    }
    field.setCustomValidity?.(
      valid || field.value === ''
        ? ''
        : 'Lettres, chiffres, tirets ou underscore ; 64 caractères maximum.',
    );
    vscode.postMessage({
      action: 'name',
      token,
      name: valid ? field.value : '',
    });
    const create = document.querySelector?.('button[data-agent-create]');
    if (create) create.disabled = !valid || create.dataset.ready !== 'true';
  });
  document.addEventListener('change', (event) => {
    const select = event.target.closest('select[data-action]');
    if (
      !select ||
      !['language', 'stack', 'backend', 'ai', 'model', 'key'].includes(
        select.dataset.action,
      )
    )
      return;
    if (
      ['backend', 'ai'].includes(select.dataset.action) &&
      select.value === ''
    ) {
      vscode.postMessage({
        action:
          select.dataset.action === 'backend' ? 'clearBackend' : 'clearAi',
        token,
      });
      return;
    }
    if (select.dataset.action === 'key' && select.value === '') {
      vscode.postMessage({ action: 'clearKey', token });
      return;
    }
    if (select.dataset.action === 'model' && select.value === '') {
      vscode.postMessage({ action: 'clearModel', token });
      return;
    }
    if (select.dataset.action === 'stack' && select.value === '') {
      vscode.postMessage({ action: 'clear', token });
      return;
    }
    if (!/^[a-f0-9]{32}$/.test(select.value ?? '')) return;
    vscode.postMessage({
      action: select.dataset.action,
      token,
      index: select.value,
    });
  });
  document.addEventListener('click', (event) => {
    if (
      event.target.closest('select[data-action="model"]') ||
      event.target.closest('select[data-action="key"]')
    ) {
      refreshModelList();
      return;
    }
    const button = event.target.closest('button[data-action]');
    if (
      !button ||
      button.disabled ||
      !actions.has(button.dataset.action) ||
      ['language', 'stack'].includes(button.dataset.action)
    )
      return;
    const action = button.dataset.action;
    const indexed = ['preview', 'create', 'edit'].includes(action);
    if (indexed && !/^[a-f0-9]{32}$/.test(button.dataset.index ?? '')) return;
    vscode.postMessage({
      action,
      token,
      ...(indexed ? { index: button.dataset.index } : {}),
    });
  });
})();
