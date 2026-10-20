const assert=require('node:assert/strict');
const {test}=require('node:test');
const Module=require('node:module');
const provider=require('../dist/provider');
const org='11111111-1111-1111-1111-111111111111',id='22222222-2222-2222-2222-222222222222';
const key='synthetic_test_key_not_a_secret_123';
function setup() {
 const secrets=new Map(),state=new Map(), inputs=['Test',org,key];let requests=0;
 const vscode={workspace:{isTrusted:true},ProgressLocation:{Notification:15},window:{
  showInputBox:async()=>inputs.shift(),showInformationMessage:async(_m,opts,action)=>action,
  showErrorMessage:async()=>{},showWarningMessage:async()=>{},showQuickPick:async items=>items[0],
  withProgress:async(_opts,fn)=>fn({}, {onCancellationRequested:()=>({dispose(){}})}),
 }};
 const context={globalState:{get:k=>state.get(k),update:async(k,v)=>v===undefined?state.delete(k):state.set(k,v)},
 secrets:{get:async k=>secrets.get(k),store:async(k,v)=>secrets.set(k,v),delete:async k=>secrets.delete(k)}};
 const original=Module._load;
 Module._load=function(name,...rest){return name==='vscode'?vscode:original.call(this,name,...rest);};
 delete require.cache[require.resolve('../dist/connection')];
 let Connection;try {Connection=require('../dist/connection').Connection;}finally{Module._load=original;}
 const old=provider.listProjects;
 provider.listProjects=async(o,k)=>{requests++;assert.equal(o,org);assert.equal(k,key);return [{id,name:'Project',organizationId:org}];};
 return {connection:new Connection(context,()=>{}),secrets,state,inputs,vscode,requests:()=>requests,restore:()=>{provider.listProjects=old;}};
}
test('native login stores API key only in SecretStorage, selects scope, disconnect deletes',async()=>{
 const s=setup();try {
 assert.equal(s.requests(),0);await s.connection.login();assert.equal(s.requests(),1);
 assert.equal(s.secrets.get('scalewayAI.apiKey.v1'),key);assert.equal(s.connection.project.id,id);
 assert.ok(!JSON.stringify([...s.state]).includes(key));assert.ok(!JSON.stringify(s.connection.metadata).includes(key));
 await s.connection.disconnect();assert.equal(s.secrets.size,0);assert.equal(s.state.size,0);assert.equal(s.connection.project,undefined);
 }finally{s.restore();}
});
test('declined permission makes no request or secret write',async()=>{
 const s=setup();s.vscode.window.showInformationMessage=async()=>undefined;
 try {await s.connection.login();assert.equal(s.requests(),0);assert.equal(s.secrets.size,0);}finally{s.restore();}
});
test('disconnect while login confirmation open invalidates pending operation',async()=>{
 const s=setup();s.vscode.window.showInformationMessage=async()=>{await s.connection.disconnect();return 'Lister les projets';};
 try {await s.connection.login();assert.equal(s.requests(),0);assert.equal(s.secrets.size,0);}finally{s.restore();}
});
