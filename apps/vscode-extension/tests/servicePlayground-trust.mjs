// Actual Workspace Trust UI, not workspace.isTrusted monkeypatching.
import fs from 'node:fs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch('http://127.0.0.1:9338/json')).json();
const ws = new WebSocket(
  targets.find((t) => t.type === 'page').webSocketDebuggerUrl,
);
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
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true })).result
    ?.result?.value;
try {
  await send('Page.bringToFront');
  let before;
  for (let i = 0; i < 100; i++) {
    before = await evaluate('document.body.innerText');
    if (before.includes('You trust this folder')) break;
    await delay(100);
  }
  if (!before.includes('You trust this folder'))
    throw Error('Expected actual trust management editor');
  const point = await evaluate(
    '(() => { const e = [...document.querySelectorAll(".monaco-button")].find(e => e.textContent === "Don" + String.fromCharCode(39) + "t Trust"); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()',
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  // Original-host liveness expires after five seconds; allow renderer scheduling.
  await delay(7500);
  const after = await evaluate('document.body.innerText');
  const updated = await (await fetch('http://127.0.0.1:9338/json')).json();
  const iframe = updated.find((t) => t.type === 'iframe');
  if (!iframe) throw Error('Preserved playground webview missing');
  const frame = new WebSocket(iframe.webSocketDebuggerUrl);
  await new Promise((r) => frame.addEventListener('open', r, { once: true }));
  const snapshot = await new Promise((r) => {
    frame.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) r(m.result?.result?.value);
    });
    frame.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression:
            '(() => { const d=document.querySelector("iframe").contentDocument; return {status:d.getElementById("status").textContent,partial:d.getElementById("response").textContent,runDisabled:d.getElementById("run").disabled,stopDisabled:d.getElementById("stop").disabled}; })()',
          returnByValue: true,
        },
      }),
    );
  });
  const attempt = await new Promise((resolve) => {
    frame.addEventListener('message', (event) => {
      const m = JSON.parse(event.data);
      if (m.id === 2) resolve(m.result?.result?.value);
    });
    frame.send(
      JSON.stringify({
        id: 2,
        method: 'Runtime.evaluate',
        params: {
          expression:
            '(() => { const w=document.querySelector("iframe").contentWindow;const d=w.document;const before=w.qaSends.length;d.getElementById("run").click();d.getElementById("prompt").dispatchEvent(new w.KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true}));w.dispatchEvent(new w.MessageEvent("message",{data:{type:"state",runId:999,running:false,blocked:false,output:"LATE_AFTER_RESTART",status:"Ready"}}));return {sends:w.qaSends.length-before,output:d.getElementById("response").textContent,runDisabled:d.getElementById("run").disabled}; })()',
          returnByValue: true,
        },
      }),
    );
  });
  frame.close();
  const checks = [
    {
      name: 'no replay or late update after host loss',
      passed:
        attempt.sends === 0 &&
        attempt.runDisabled &&
        attempt.output === snapshot.partial,
    },
    {
      name: 'actual Workspace Trust UI enters Restricted Mode',
      passed: after.includes('You are in Restricted Mode'),
    },
    {
      name: 'partial response retained',
      passed: snapshot.partial === 'Réponse partielle conservée',
    },
    {
      name: 'revocation displays blocked session status',
      passed: snapshot.status.includes('Session'),
    },
    {
      name: 'stale running controls cleared',
      passed: snapshot.runDisabled && snapshot.stopDisabled,
    },
  ];
  fs.writeFileSync(
    process.argv[2],
    JSON.stringify(
      {
        checks,
        before,
        after,
        snapshot,
        method:
          'Actual Workspace Trust editor Dont Trust button via native Chromium mouse input; real Extension Host restart, no isTrusted mock',
        cloud: 0,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, snapshot }));
  if (checks.some((c) => !c.passed)) process.exitCode = 1;
} finally {
  ws.close();
}
