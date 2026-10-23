import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets, t;
for (let i = 0; i < 100; i++) {
  targets = await (await fetch('http://127.0.0.1:9338/json')).json();
  t = targets.find((x) => x.type === 'iframe');
  if (t) break;
  await sleep(100);
}
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.(m);
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression:
      '(() => { const w=document.querySelector("iframe").contentWindow;const d=w.document;const el=id=>d.getElementById(id);' +
      expression +
      '})()',
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result?.result?.value;
};
const key = async (k, code, vk, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: k,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers,
  });
  if (k === 'Enter' && !modifiers)
    await send('Input.dispatchKeyEvent', {
      type: 'char',
      text: '\r',
      unmodifiedText: '\r',
      key: k,
      code,
      windowsVirtualKeyCode: vk,
    });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: k,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers,
  });
  await sleep(150);
};
const checks = [];
const check = (name, ok) => {
  checks.push({ name, passed: !!ok });
  if (!ok) throw Error(name);
};
const wait = async (expr) => {
  for (let i = 0; i < 100; i++) {
    if (await ev('return ' + expr)) return;
    await sleep(100);
  }
  throw Error('timeout ' + expr);
};
try {
  await wait('!el("run").disabled');
  await ev('el("prompt").value="normal";el("prompt").focus();');
  await key('Tab', 'Tab', 9);
  check(
    'native Tab prompt to maxTokens',
    await ev('return d.activeElement.id==="maxTokens"'),
  );
  await key('Tab', 'Tab', 9);
  check(
    'native Tab maxTokens to Run',
    await ev('return d.activeElement.id==="run"'),
  );
  await key('Tab', 'Tab', 9, 8);
  check(
    'native Shift+Tab Run to maxTokens',
    await ev('return d.activeElement.id==="maxTokens"'),
  );
  await key('Tab', 'Tab', 9, 8);
  check(
    'native Shift+Tab maxTokens to prompt',
    await ev('return d.activeElement.id==="prompt"'),
  );
  check(
    'native focus outline',
    await ev(
      'return w.getComputedStyle(d.activeElement).outlineStyle!=="none"',
    ),
  );
  await key('Enter', 'Enter', 13, 2);
  await wait('el("response").textContent==="Bonjour "');
  check('native Ctrl+Enter starts stream', true);
  await wait('!el("run").disabled');
  await ev('el("prompt").value="stop";');
  await key('Tab', 'Tab', 9);
  await key('Tab', 'Tab', 9);
  await key('Enter', 'Enter', 13);
  await wait('el("response").textContent==="Réponse partielle conservée"');
  await key('Tab', 'Tab', 9);
  check(
    'native Tab Run to enabled Stop',
    await ev('return d.activeElement.id==="stop"'),
  );
  await key('Enter', 'Enter', 13);
  await wait('!el("run").disabled');
  check(
    'native Enter Stop preserves partial',
    await ev(
      'return el("response").textContent==="Réponse partielle conservée"',
    ),
  );
  await ev('el("prompt").value="error";el("prompt").focus();');
  await key('Enter', 'Enter', 13, 2);
  await wait('el("status").textContent.includes("quota")');
  check(
    'native events are trusted Chromium input',
    await ev('return w.qaKeys.length>=10&&w.qaKeys.every(e=>e.trusted)'),
  );
  await ev('w.qaPost({type:"qa-invalidate"});');
  await wait('el("status").textContent.includes("Session")');
  const keys = await ev('return w.qaKeys');
  fs.writeFileSync(
    process.argv[2],
    JSON.stringify(
      {
        checks,
        keys,
        method:
          'Chromium CDP Input.dispatchKeyEvent (rawKeyDown/keyUp), native default Tab/Shift+Tab/Enter; no DOM keyboard dispatch/click',
        cloud: 0,
      },
      null,
      2,
    ),
  );
  await ev('w.qaPost(' + JSON.stringify({ type: 'qa-result', checks }) + ');');
  console.log(JSON.stringify(checks));
} catch (e) {
  console.log(String(e));
  console.log(
    await ev(
      'return {active:d.activeElement.id,keys:w.qaKeys,status:el("status").textContent}',
    ),
  );
  process.exitCode = 1;
} finally {
  ws.close();
}
