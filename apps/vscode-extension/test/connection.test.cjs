const assert=require('node:assert/strict');
const {test}=require('node:test');
const Module=require('node:module');
const provider=require('../dist/provider');const auth=require('../dist/browserLogin');
const org='11111111-1111-1111-1111-111111111111',id='22222222-2222-2222-2222-222222222222';
const token='eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
function setup() {
 const secrets=new Map([['scalewayAI.apiKey.v1','legacy_do_not_read']]),state=new Map([['scalewayAI.connection',{name:'legacy',organizationId:org}]]);let requests=0,opened=0,logins=0;const inputs=[];
 const vscode={workspace:{isTrusted:true},env:{openExternal:async()=>{opened++;return true;}},Uri:{parse:v=>v},ProgressLocation:{Notification:15},window:{
  showInputBox:async opts=>{inputs.push(opts);return org;},showInformationMessage:async(_m,opts,action)=>action,
  showErrorMessage:async()=>{},showWarningMessage:async()=>{},showQuickPick:async items=>items[0],
  withProgress:async(_opts,fn)=>fn({}, {onCancellationRequested:()=>({dispose(){}})}),
 }};
 const context={globalState:{get:k=>state.get(k),update:async(k,v)=>v===undefined?state.delete(k):state.set(k,v)},
 secrets:{get:async()=>{throw Error('must never import API key');},store:async()=>{throw Error('memory only');},delete:async k=>secrets.delete(k)}};
 const original=Module._load;Module._load=function(name,...rest){return name==='vscode'?vscode:original.call(this,name,...rest);};
 delete require.cache[require.resolve('../dist/connection')];let Connection;try{Connection=require('../dist/connection').Connection;}finally{Module._load=original;}
 const old=provider.listProjects,oldAuth=auth.browserLogin,oldDedicated=provider.listDedicated;
 provider.listProjects=async(o,k)=>{requests++;assert.equal(o,org);assert.equal(k,token);return [{id,name:'Project',organizationId:org}];};
 provider.listDedicated=async(p,k)=>{requests++;assert.equal(k,token);return [];};
 auth.browserLogin=async open=>{logins++;await open('https://account.scaleway.com/authenticate?redirectToUrl=synthetic');return {token,expiresAt:Date.now()+3600000,userId:org};};
 return {connection:new Connection(context,()=>{}),secrets,state,inputs,vscode,requests:()=>requests,opened:()=>opened,logins:()=>logins,restore:()=>{provider.listProjects=old;auth.browserLogin=oldAuth;provider.listDedicated=oldDedicated;}};
}
test('user browser login receives JWT, reads projects, no secret input/store; removes legacy key',async()=>{
 const s=setup();try {
 assert.equal(s.requests(),0);assert.equal(s.connection.metadata,undefined);await s.connection.login();assert.equal(s.opened(),1);assert.equal(s.requests(),1);assert.equal(s.connection.project.id,id);
 assert.equal(s.inputs.length,1);assert.ok(!s.inputs[0].password);assert.equal(s.secrets.size,0);assert.equal(s.state.size,0);assert.ok(!JSON.stringify(s.connection.metadata).includes(token));
 await s.connection.loadModels();assert.equal(s.requests(),2);assert.equal(s.connection.serverless.length,0);
 await s.connection.switchProject();assert.equal(s.logins(),1);
 await s.connection.disconnect();assert.equal(s.connection.project,undefined);assert.equal(s.connection.metadata,undefined);
 }finally{s.connection.dispose();s.restore();}
});
test('declined browser consent never opens or reads',async()=>{
 const s=setup();s.vscode.window.showInformationMessage=async()=>undefined;
 try{await s.connection.login();assert.equal(s.opened(),0);assert.equal(s.requests(),0);}finally{s.connection.dispose();s.restore();}
});
test('disconnect during browser consent invalidates operation',async()=>{
 const s=setup();s.vscode.window.showInformationMessage=async()=>{await s.connection.disconnect();return 'Se connecter';};
 try{await s.connection.login();assert.equal(s.opened(),0);assert.equal(s.requests(),0);}finally{s.connection.dispose();s.restore();}
});
test('remote host blocked before browser; expired session drops scope without reads',async()=>{
 const s=setup();try {
 s.vscode.env.remoteName='ssh-remote';await s.connection.login();assert.equal(s.opened(),0);
 s.vscode.env.remoteName=undefined;await s.connection.login();const before=s.requests();s.connection.session.expiresAt=Date.now()-1;
 await s.connection.loadModels();assert.equal(s.requests(),before);assert.equal(s.connection.project,undefined);assert.equal(s.connection.metadata,undefined);
 }finally{s.connection.dispose();s.restore();}
});
test('late browser result after disconnect cannot restore session',async()=>{
 const s=setup();const old=auth.browserLogin;
 auth.browserLogin=async()=>{await s.connection.disconnect();return {token,expiresAt:Date.now()+3600000,userId:org};};
 try{await s.connection.login();assert.equal(s.requests(),0);assert.equal(s.connection.metadata,undefined);}finally{auth.browserLogin=old;s.connection.dispose();s.restore();}
});
