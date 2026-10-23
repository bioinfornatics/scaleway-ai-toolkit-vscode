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
async function key(c, key, code, vk) {
  await c.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
  });
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
  });
  await sleep(180);
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
async function run(prompt) {
  await ui(`el("prompt").value=${JSON.stringify(prompt)};el("run").click();`);
}
try {
  await wait(
    () =>
      fs.existsSync(`${resultPath}.stages`) &&
      JSON.parse(fs.readFileSync(`${resultPath}.stages`)).stages.includes(
        'ready-native',
      ),
    'host ready',
  );
  wb = await connect(
    await wait(
      async () => (await targets()).find((t) => t.type === 'page'),
      'workbench',
    ),
  );
  await open();
  const picker = await body();
  native.push({ kind: 'endpoint picker', text: picker });
  check(
    'actual picker shows IAM and disabled descriptions',
    picker.includes('IAM · clé API requise') &&
      picker.includes('Authentification désactivée'),
  );
  await shot(wb, 'native-picker');
  await key(wb, 'Escape', 'Escape', 27);
  await sleep(300);
  check(
    'picker cancel zero requests and panels',
    JSON.parse(fs.readFileSync(`${resultPath}.stages`)).calls === 0 &&
      JSON.parse(fs.readFileSync(`${resultPath}.stages`)).panels === 0,
  );
  await open();
  await modal();
  await shot(wb, 'native-consent');
  await click(
    wb,
    '[...document.querySelectorAll("[role=dialog] .monaco-button, .monaco-dialog-box .monaco-button")].find(e=>e.textContent.includes("Cancel")||e.textContent.includes("Annuler"))',
  );
  await sleep(300);
  check(
    'modal cancel zero requests and panels',
    JSON.parse(fs.readFileSync(`${resultPath}.stages`)).calls === 0 &&
      JSON.parse(fs.readFileSync(`${resultPath}.stages`)).panels === 0,
  );
  await open();
  await modal();
  control('scope-change');
  await sleep(400);
  await click(
    wb,
    '[...document.querySelectorAll("[role=dialog] .monaco-button, .monaco-dialog-box .monaco-button")].find(e=>e.textContent.includes("Approuver cet endpoint"))',
  );
  await sleep(400);
  check(
    'native consent changed scope refuses panel',
    JSON.parse(fs.readFileSync(`${resultPath}.stages`)).panels === 0,
  );
  control('reset');
  await sleep(200);
  await open();
  await modal();
  await approve();
  check(
    'opening approved installed panel zero sends/credentials',
    JSON.parse(fs.readFileSync(`${resultPath}.stages`)).calls === 0 &&
      JSON.parse(fs.readFileSync(`${resultPath}.stages`)).credentials === 0,
  );
  await shot(wb, 'iam-ready');
  check(
    'renderer exact destination and model',
    await ui(
      'return d.body.innerText.includes("vendor/model:fp8")&&d.body.innerText.includes("/v1/chat/completions")',
    ),
  );
  await run('normal');
  await wait(
    () => ui('return el("response").textContent==="Bonjour "'),
    'partial',
  );
  check(
    'one Run one physical mock POST',
    JSON.parse(fs.readFileSync(`${resultPath}.stages`)).calls === 1,
  );
  await shot(wb, 'stream');
  await wait(() => ui('return !el("run").disabled'), 'normal end');
  check(
    'SSE completion usage and duration billing',
    await ui(
      'return el("response").textContent==="Bonjour mock HTTPS SSE."&&el("usage").textContent.includes("5 total tokens")&&el("cost").textContent.includes("aucune estimation par tokens")',
    ),
  );
  await run('stop');
  await wait(
    () => ui('return el("response").textContent==="Partial retained"'),
    'stop partial',
  );
  await ui('el("stop").click();');
  await sleep(1500);
  check(
    'Stop retains partial and rejects late SSE',
    await ui(
      'return el("response").textContent==="Partial retained"&&!el("run").disabled',
    ),
  );
  await shot(wb, 'stopped');
  await run('error');
  await wait(
    () =>
      ui('return el("status").textContent.includes("Connexion interrompue")'),
    'error',
  );
  check(
    'network error partial retained and sanitized',
    await ui(
      'return el("response").textContent==="Partial before error"&&!d.body.innerText.includes("upstream private detail")',
    ),
  );
  await shot(wb, 'error');
  await run('mismatch');
  await wait(
    () => ui('return el("status").textContent.includes("Identité")'),
    'model mismatch',
  );
  check(
    'model mismatch rejected without output',
    await ui('return el("response").textContent===""'),
  );
  await run('scope');
  await wait(
    () => ui('return el("response").textContent==="Partial retained"'),
    'scope partial',
  );
  await ui('w.qaPost({type:"qa-control",action:"scope"});');
  await sleep(1600);
  check(
    'scope change blocks and ignores late output',
    await ui(
      'return el("run").disabled&&el("response").textContent==="Partial retained"&&el("status").textContent.includes("Session")',
    ),
  );
  await shot(wb, 'scope-blocked');
  await ui('w.qaPost({type:"qa-control",action:"open-disabled"});');
  await wait(
    async () => (await body()).includes('Ouvrir dans le playground'),
    'disabled service picker',
  );
  await click(
    wb,
    '[...document.querySelectorAll(".quick-input-widget .monaco-list-row")].find(e=>e.textContent.includes("Ouvrir dans le playground"))',
  );
  await wait(
    async () =>
      (await body()).includes('Sélectionner un endpoint public dédié'),
    'disabled endpoint',
  );
  await modal(true);
  await shot(wb, 'disabled-consent');
  await approve(true);
  const before = JSON.parse(
    fs.readFileSync(`${resultPath}.stages`),
  ).credentials;
  await run('disabled');
  await wait(
    () => ui('return el("status").textContent==="Réponse terminée"'),
    'disabled completed',
  );
  check(
    'disabled authentication never accesses credential',
    JSON.parse(fs.readFileSync(`${resultPath}.stages`)).credentials === before,
  );
  check(
    'disabled panel no IAM claim',
    await ui('return d.body.innerText.includes("DISABLED")'),
  );
  await shot(wb, 'disabled-completed');
  await ui(
    `w.qaPost(${JSON.stringify({ type: 'qa-result', checks, native, limitations: ['No live reachability, TLS handshake, IAM rights or billing verification. Mock asserts TLS verification option only. Renderer Run/Stop exercised via DOM clicks; native consent/pickers use CDP trusted input. Workspace trust revocation and logout not exercised in this dedicated run.'] })});`,
  );
  await wait(() => fs.existsSync(resultPath), 'host result');
  console.log(JSON.stringify({ checks, passed: true }));
} catch (e) {
  console.error(e.stack);
  if (wb) {
    console.error(await body());
    await shot(wb, 'failure');
  }
  process.exitCode = 1;
} finally {
  for (const client of clients) client.ws.close();
}
