const assert=require('node:assert/strict');const {test}=require('node:test');const fs=require('node:fs');const Module=require('node:module');
const original=Module._load;Module._load=function(name,...args){return name==='vscode'?{}:original.call(this,name,...args);};
const {parseCatalogInput}=require('../dist/catalog');Module._load=original;
test('closed catalog IPC excludes credentials and arbitrary provider routes',()=>{
 for(const value of [null,[],{type:'ready',secret:'x'},{type:'refresh',endpoint:'evil'},{type:'run'},{type:'project',uuid:'x'}])assert.equal(parseCatalogInput(value),undefined);
 for(const type of ['ready','refresh','project'])assert.deepEqual(parseCatalogInput({type}),{type});
});
test('catalog renderer has text-only model cards and no browser HTTP',()=>{
 const s=fs.readFileSync('media/catalog.js','utf8');assert.ok(!/innerHTML|fetch?\(/.test(s));assert.ok(s.includes('title.textContent=row.label'));assert.ok(s.includes('root.replaceChildren()'));
 const host=fs.readFileSync('src/extension.ts','utf8');const a=host.indexOf("register('scalewayAI.openCatalog'");const b=host.indexOf("register('scalewayAI.disconnect'",a);
 assert.ok(host.slice(a,b).indexOf('createWebviewPanel')<host.slice(a,b).indexOf('await connection.loadPublicCatalog()'));
});

test('implemented navigation separates discover, build, recent and local demo; project chooser is not cloud creation',()=>{
 const source=fs.readFileSync('src/extension.ts','utf8');
 for(const text of ['Récents','Ressources locales','Construire','scalewayAI.setProject','Changer de projet'])assert.ok(source.includes(text));
 assert.ok(!source.includes("label: 'Construire et tester'"));
 const pkg=require('../package.json');assert.ok(pkg.contributes.commands.some(c=>c.command==='scalewayAI.setProject'));assert.ok(!pkg.contributes.commands.some(c=>c.command==='scalewayAI.createProject'));
});
