const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const forbidden = () => {
  throw new Error('Network or persistence forbidden');
};
// Compile current sources without consuming mutable dist or writing build outputs.
function loadSource(name, overrides = {}, cache = new Map()) {
  const filename = path.resolve(__dirname, '../../src', name + '.ts');
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  cache.set(filename, loaded);
  loaded.require = (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id === 'vscode')
      return {
        Uri: { joinPath: (root, ...parts) => [root, ...parts].join('/') },
      };
    if (id === './scalewaySdk') return { readDedicatedJSON: forbidden };
    if (id === 'node:https') return { request: forbidden, get: forbidden };
    if (id.startsWith('.'))
      return loadSource(
        path.relative(
          path.resolve(__dirname, '../../src'),
          path.resolve(path.dirname(filename), id),
        ),
        overrides,
        cache,
      );
    return require(id);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
  return loaded.exports;
}
function domFromHtml(html, Element) {
  const elements = new Map();
  for (const match of html.matchAll(
    /<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi,
  )) {
    const [, tag, attributes, id] = match;
    if (elements.has(id)) throw new Error('Duplicate HTML ID: ' + id);
    const element = new Element(tag);
    element.id = id;
    element.value ??= '';
    element.textContent ??= '';
    element.dataset ??= {};
    element.disabled = /\bdisabled\b/.test(attributes);
    element.hidden = /\bhidden\b/.test(attributes);
    const value = attributes.match(/\bvalue="([^"]*)"/);
    if (value) element.value = value[1];
    for (const data of attributes.matchAll(/data-([a-z-]+)="([^"]*)"/g))
      element.dataset[data[1]] = data[2];
    elements.set(id, element);
  }
  return {
    elements,
    get: (id) => {
      if (!elements.has(id))
        throw new Error('Missing required HTML element: ' + id);
      return elements.get(id);
    },
  };
}
function catalogHtml() {
  return loadSource('catalog').catalogHtml(
    { cspSource: 'local:', asWebviewUri: (uri) => uri },
    '/extension',
  );
}
module.exports = { loadSource, domFromHtml, catalogHtml, forbidden };
