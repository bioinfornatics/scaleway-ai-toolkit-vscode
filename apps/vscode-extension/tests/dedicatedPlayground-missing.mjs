import fs from 'node:fs';

const [resultPath, root] = process.argv.slice(2),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];
const checks = [],
  native = [];
const check = (name, ok) => {
  checks.push({ name, passed: !!ok });
  if (!ok) throw Error(name);
};
async function targets() {
  return (await fetch('http://127.0.0.1:9343/json')).json();
}
async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    }
  });
  const c = {
    ws,
    send: (method, params = {}) =>
      new Promise((r, j) => {
        const i = ++id;
        pending.set(i, (m) =>
          m.error ? j(Error(JSON.stringify(m.error))) : r(m.result),
        );
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
  };
  clients.push(c);
  return c;
}
async function ev(c, expression) {
  const r = await c.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
async function wait(fn, name) {
  for (let i = 0; i < 150; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(100);
  }
  throw Error(`timeout ${name}`);
}
async function key(c, key, code, vk, modifiers = 0) {
  await c.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    modifiers,
  });
  if (key === 'Enter')
    await c.send('Input.dispatchKeyEvent', {
      type: 'char',
      text: '\r',
      key,
      code,
      windowsVirtualKeyCode: vk,
      modifiers,
    });
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    modifiers,
  });
  await sleep(80);
}
async function click(c, expr) {
  const p = await ev(
    c,
    `(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  if (!p) throw Error(`missing ${expr}`);
  await c.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...p,
    button: 'left',
    clickCount: 1,
  });
  await c.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...p,
    button: 'left',
    clickCount: 1,
  });
  await sleep(200);
}
async function shot(c, name) {
  if (
    frame &&
    [
      'stream',
      'stopped',
      'error',
      'scope-blocked',
      'disabled-completed',
    ].includes(name)
  ) {
    await ui('el("response").scrollIntoView({block:"center"});');
    await sleep(100);
  }
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(
    `${root}/artifacts/validation/dedicated-playground-398-${name}.png`,
    Buffer.from(r.data, 'base64'),
  );
}
const control = (s) => fs.writeFileSync(`${resultPath}.control`, s);
let wb, frame;
const body = () => ev(wb, 'document.body.innerText');
const ui = (expr) =>
  ev(
    frame,
    `(()=>{const w=document.querySelector("iframe").contentWindow;const d=w.document;const el=id=>d.getElementById(id);${expr}})()`,
  );
async function open() {
  control('open');
  await wait(
    async () => (await body()).includes('Ouvrir dans le playground'),
    'service picker',
  );
  await click(
    wb,
    '[...document.querySelectorAll(".quick-input-widget .monaco-list-row")].find(e=>e.textContent.includes("Ouvrir dans le playground"))',
  );
  await wait(
    async () =>
      (await body()).includes('Sélectionner un endpoint public dédié'),
    'endpoint picker',
  );
}
async function modal(disabled = false) {
  await click(
    wb,
    `[...document.querySelectorAll(".quick-input-widget .monaco-list-row")].find(e=>e.textContent.includes(${JSON.stringify(disabled ? 'Authentification désactivée' : 'IAM · clé API requise')}))`,
  );
  await wait(
    async () => (await body()).includes('Confirmer l’endpoint dédié exact'),
    'native modal',
  );
  const text = await body();
  native.push({ kind: disabled ? 'disabled modal' : 'IAM modal', text });
  check(
    `native modal exact model URL and billing ${native.length}`,
    text.includes('vendor/model:fp8') &&
      text.includes(
        '33333333-3333-3333-3333-333333333333.ifr.fr-par.scaleway.com',
      ) &&
      text.includes('30 minutes') &&
      text.includes('pas aux tokens'),
  );
}
async function approve(_disabled = false) {
  await click(
    wb,
    '[...document.querySelectorAll("[role=dialog] .monaco-button, .monaco-dialog-box .monaco-button")].find(e=>e.textContent.includes("Approuver cet endpoint"))',
  );
  frame = await connect(
    await wait(
      async () => (await targets()).find((t) => t.type === 'iframe'),
      'installed iframe',
    ),
  );
  await wait(
    () => ui('return !!el("run")&&!el("run").disabled'),
    'panel ready',
  );
}
const state = () => JSON.parse(fs.readFileSync(`${resultPath}.stages`));
const snapshot = () =>
  ui(
    'return {status:el("status").textContent,output:el("response").textContent,runDisabled:el("run").disabled,stopDisabled:el("stop").disabled,focus:d.activeElement.id,sends:w.qaRunPosts.length}',
  );
async function promptInput(text) {
  await ui('el("prompt").scrollIntoView({block:"center"});');
  await click(
    frame,
    'document.querySelector("iframe").contentDocument.getElementById("prompt")',
  );
  await frame.send('Input.insertText', { text });
  check(
    `native prompt focus ${text}`,
    await ui('return d.activeElement.id==="prompt"'),
  );
}
async function keyboardRun(text, shortcut = false) {
  await promptInput(text);
  if (shortcut) await key(frame, 'Enter', 'Enter', 13, 2);
  else {
    await key(frame, 'Tab', 'Tab', 9);
    check(
      'Tab reaches token input',
      await ui('return d.activeElement.id==="maxTokens"'),
    );
    await key(frame, 'Tab', 'Tab', 9);
    check(
      'Tab reaches Run button',
      await ui('return d.activeElement.id==="run"'),
    );
    await key(frame, 'Enter', 'Enter', 13);
  }
  await wait(
    () => ui('return el("response").textContent==="Partial retained"'),
    `${text} partial`,
  );
}
try {
  await wait(
    () =>
      fs.existsSync(`${resultPath}.stages`) &&
      state().stages.includes('ready-native'),
    'host ready',
  );
  wb = await connect(
    await wait(
      async () => (await targets()).find((t) => t.type === 'page'),
      'workbench',
    ),
  );
  await wb.send('Page.bringToFront');
  await open();
  await modal();
  await approve();
  await keyboardRun('stop');
  check('native Run one request', state().calls === 1);
  // Focus returns to prompt via actual pointer; keyboard skips disabled Run.
  await click(
    frame,
    'document.querySelector("iframe").contentDocument.getElementById("prompt")',
  );
  await key(frame, 'Tab', 'Tab', 9);
  await key(frame, 'Tab', 'Tab', 9);
  check(
    'Tab skips disabled Run and reaches Stop',
    await ui('return d.activeElement.id==="stop"'),
  );
  await shot(wb, 'keyboard-stop-focus');
  await key(frame, 'Enter', 'Enter', 13);
  await sleep(1600);
  const stopped = await snapshot();
  check(
    'native keyboard Stop retains partial no late SSE',
    stopped.output === 'Partial retained' &&
      !stopped.runDisabled &&
      stopped.stopDisabled &&
      state().lateFrames === 1,
  );
  await shot(wb, 'keyboard-stopped');
  // Fresh approved panel for logout; no automatic replay on opening.
  await open();
  await modal();
  await approve();
  check('reopen zero automatic sends', state().calls === 1);
  await keyboardRun('logout', true);
  check('native Ctrl Enter exactly one request', state().calls === 2);
  control('logout');
  await wait(() => !state().connected, 'logout disconnected');
  await sleep(1600);
  const loggedOut = await snapshot();
  check(
    'logout retains partial and clears Run Stop',
    loggedOut.output === 'Partial retained' &&
      loggedOut.runDisabled &&
      loggedOut.stopDisabled &&
      !state().connected &&
      state().lateFrames === 2,
  );
  await key(frame, 'Enter', 'Enter', 13, 2);
  await sleep(250);
  check('logout keyboard cannot replay', state().calls === 2);
  await shot(wb, 'logout-blocked');
  control('reconnect');
  await wait(
    () => state().stages.includes('synthetic reconnect'),
    'synthetic reconnect',
  );
  await open();
  await modal();
  await approve();
  check('reconnect no auto replay', state().calls === 2);
  await keyboardRun('trust', true);
  check('trust partial one explicit request', state().calls === 3);
  const originalPid = state().pid;
  // Persist old host transport ledger before the actual host is restarted.
  fs.writeFileSync(
    `${resultPath}.native-result`,
    JSON.stringify({
      checks,
      native,
      limitations: [
        'Missing acceptance run; no cloud or real TLS/credentials/billing.',
      ],
    }),
  );
  control('trust-ui');
  await wait(
    async () => (await body()).includes('You trust this folder'),
    'actual Workspace Trust editor',
  );
  control('finish');
  await wait(() => fs.existsSync(resultPath), 'ledger persisted');
  const trustBefore = await body();
  await click(
    wb,
    '[...document.querySelectorAll(".monaco-button")].find(e=>e.textContent==="Don"+String.fromCharCode(39)+"t Trust")',
  );
  await sleep(8500);
  const trustAfter = await body();
  check(
    'actual Dont Trust enters Restricted Mode',
    trustAfter.includes('You are in Restricted Mode'),
  );
  const activationPids = fs
    .readFileSync(`${resultPath}.activations`, 'utf8')
    .trim()
    .split(/\s+/);
  check(
    'real Extension Host restarted',
    activationPids.length >= 2 && activationPids.at(-1) !== String(originalPid),
  );
  frame = await connect(
    await wait(
      async () => (await targets()).find((t) => t.type === 'iframe'),
      'retained webview',
    ),
  );
  const revoked = await snapshot();
  check(
    'trust restart partial retained fail closed',
    revoked.output === 'Partial retained' &&
      revoked.runDisabled &&
      revoked.stopDisabled &&
      revoked.status.includes('Session'),
  );
  await shot(wb, 'trust-restart-blocked');
  await click(
    frame,
    'document.querySelector("iframe").contentDocument.getElementById("prompt")',
  );
  await key(frame, 'Enter', 'Enter', 13, 2);
  await ui(
    'el("run").click();w.dispatchEvent(new w.MessageEvent("message",{data:{type:"state",runId:999,running:false,blocked:false,output:"LATE_AFTER_RESTART",status:"Ready"}}));',
  );
  await sleep(4500);
  const afterAttempt = await snapshot();
  check(
    'restart no keyboard DOM replay or late state',
    afterAttempt.sends === revoked.sends &&
      afterAttempt.output === revoked.output &&
      afterAttempt.runDisabled &&
      afterAttempt.stopDisabled,
  );
  const r = JSON.parse(fs.readFileSync(resultPath));
  r.checks = [
    ...r.checks.filter((c) => !checks.some((n) => n.name === c.name)),
    ...checks,
  ];
  r.restart = {
    originalPid,
    activationPids,
    trustBefore,
    trustAfter,
    stopped,
    loggedOut,
    revoked,
    afterAttempt,
  };
  r.method +=
    '; native Chromium Tab/Enter/Ctrl+Enter; actual Workspace Trust Dont Trust and verified host PID change';
  fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ checks, passed: true }));
} catch (e) {
  console.error(e.stack);
  if (frame) console.error(JSON.stringify(await snapshot()));
  if (wb) {
    console.error(await body());
    await shot(wb, 'missing-failure');
  }
  fs.writeFileSync(
    `${resultPath}.missing-failure`,
    JSON.stringify({ checks, error: e.stack }, null, 2),
  );
  process.exitCode = 1;
} finally {
  for (const c of clients) c.ws.close();
}
