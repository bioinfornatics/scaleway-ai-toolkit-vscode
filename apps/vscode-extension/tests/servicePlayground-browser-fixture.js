// Test-only browser driver injected by the isolated Extension Host runner.
(async () => {
  const checks = [];
  const el = (id) => document.getElementById(id);
  const check = (name, value) => {
    checks.push({ name, passed: !!value });
    vscode.postMessage({ type: 'qa-stage', name, passed: !!value });
    if (!value) throw new Error(name);
  };
  const wait = async (fn) => {
    for (let i = 0; i < 600; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timeout');
  };
  try {
    await wait(() => !el('run').disabled);
    check(
      'selected model and destination visible',
      document.body.textContent.includes('qa-configurable-text-model') &&
        document.body.textContent.includes(
          '/22222222-2222-2222-2222-222222222222/v1/chat/completions',
        ),
    );
    check(
      'ready response empty, no opening inference',
      el('response').textContent === '',
    );
    el('prompt').value = 'normal';
    el('prompt').focus();
    check('prompt receives focus', document.activeElement === el('prompt'));
    el('prompt').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await wait(() => el('response').textContent === 'Bonjour ');
    check('progressive text before completion', el('stop').disabled === false);
    await wait(() => !el('run').disabled);
    check(
      'completed plain response',
      el('response').textContent === 'Bonjour depuis le transport mocké.',
    );
    check('reported usage', el('usage').textContent.includes('13 total'));
    check('unknown cost', el('cost').textContent.includes('indisponible'));
    el('prompt').value = 'stop';
    el('run').click();
    await wait(
      () => el('response').textContent === 'Réponse partielle conservée',
    );
    el('stop').click();
    await wait(() => !el('run').disabled);
    check(
      'stop preserves partial',
      el('response').textContent === 'Réponse partielle conservée',
    );
    el('prompt').value = 'error';
    el('run').click();
    await wait(() => el('status').textContent.includes('quota'));
    check(
      'error preserves partial',
      el('response').textContent === 'Réponse partielle avant erreur',
    );
    check(
      'late response excluded',
      !el('response').textContent.includes('LATE_MUST_NOT_APPEAR'),
    );
    if (document.body.dataset.qaScope === 'trust') {
      el('prompt').value = 'stop';
      el('run').click();
      await wait(
        () => el('response').textContent === 'Réponse partielle conservée',
      );
    }
    vscode.postMessage({ type: 'qa-invalidate' });
    await wait(
      () => el('run').disabled && el('status').textContent.includes('Session'),
    );
    check(
      'scope invalidation blocks future Run',
      el('status').textContent.includes('Session'),
    );
    document.body.insertAdjacentText(
      'afterbegin',
      'VALIDATION LOCALE MOCKÉE · AUCUN APPEL CLOUD',
    );
    vscode.postMessage({ type: 'qa-result', checks });
  } catch (error) {
    vscode.postMessage({
      type: 'qa-result',
      checks: [...checks, { name: String(error), passed: false }],
    });
  }
})();
