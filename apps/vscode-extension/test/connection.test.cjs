const assert=require('node:assert/strict');
const {test}=require('node:test');
const Module=require('node:module');
const provider=require('../dist/provider');const auth=require('../dist/browserLogin');
const org='11111111-1111-1111-1111-111111111111',id='22222222-2222-2222-2222-222222222222';
const token='eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
function setup() {
 const secrets=new Map([['scalewayAI.apiKey.v1','legacy_do_not_read']]),state=new Map([['scalewayAI.connection',{name:'legacy',organizationId:org}]]);let requests=0,opened=0,logins=0;const inputs=[];
 const vscode={workspace:{isTrusted:true},env:{openExternal:async()=>{opened++;return true;}},Uri:{parse:v=>v},ProgressLocation:{Notification:15},window:{
  showInputBox:async()=>{assert.fail('UUID text input forbidden');},showInformationMessage:async(_m,opts,action)=>action,
  showErrorMessage:async()=>{},showWarningMessage:async()=>{},showQuickPick:async items=>items[0],
  withProgress:async(_opts,fn)=>fn({}, {onCancellationRequested:()=>({dispose(){}})}),
 }};
 const context={globalState:{get:k=>state.get(k),update:async(k,v)=>v===undefined?state.delete(k):state.set(k,v)},
 secrets:{get:async k=>{assert.equal(k,'scalewayAI.userSession.v1');return secrets.get(k);},store:async(k,v)=>secrets.set(k,v),delete:async k=>secrets.delete(k)}};
 const original=Module._load;Module._load=function(name,...rest){return name==='vscode'?vscode:original.call(this,name,...rest);};
 delete require.cache[require.resolve('../dist/connection')];let Connection;try{Connection=require('../dist/connection').Connection;}finally{Module._load=original;}
 const old=provider.listProjects,oldAuth=auth.browserLogin,oldDedicated=provider.listDedicated,oldOrganizations=provider.listOrganizations;
 provider.listOrganizations=async(u,k)=>{assert.equal(u,org);assert.equal(k,token);return [{id:org,name:'Organization',locked:false}];};
 provider.listProjects=async(o,k)=>{requests++;assert.equal(o,org);assert.equal(k,token);return [{id,name:'Project',organizationId:org}];};
 provider.listDedicated=async(p,k)=>{requests++;assert.equal(k,token);return [];};
 auth.browserLogin=async open=>{logins++;await open('https://account.scaleway.com/authenticate?redirectToUrl=synthetic');return {token,expiresAt:Date.now()+3600000,userId:org};};
 return {connection:new Connection(context,()=>{}),newConnection:()=>new Connection(context,()=>{}),context,secrets,state,inputs,vscode,requests:()=>requests,opened:()=>opened,logins:()=>logins,restore:()=>{provider.listProjects=old;auth.browserLogin=oldAuth;provider.listDedicated=oldDedicated;provider.listOrganizations=oldOrganizations;}};
}
test('user browser login receives JWT, reads projects, stores JWT only in SecretStorage; removes legacy key',async()=>{
 const s=setup();try {
 assert.equal(s.requests(),0);assert.equal(s.connection.metadata,undefined);await s.connection.login();assert.equal(s.opened(),1);assert.equal(s.requests(),1);assert.equal(s.connection.project.id,id);
 assert.equal(s.inputs.length,0);assert.equal(s.secrets.size,1);assert.equal(JSON.parse(s.secrets.get('scalewayAI.userSession.v1')).token,token);assert.ok(!JSON.stringify([...s.state]).includes(token));assert.ok(!JSON.stringify(s.connection.metadata).includes(token));
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

test('Organization selection silently loads projects with no modal or progress notification',async()=>{
 const s=setup();try {
 await s.connection.login();const before=s.requests();
 s.vscode.window.showInformationMessage=async()=>{assert.fail('no project-list confirmation');};
 s.vscode.window.withProgress=async()=>{assert.fail('no project loading notification');};
 await s.connection.switchProject();assert.equal(s.requests(),before+1);assert.equal(s.connection.project.id,id);
 }finally{s.connection.dispose();s.restore();}
});
test('cancelled organization selection or disconnect during picker prevents project reads',async()=>{
 const s=setup();try {
 await s.connection.login();const before=s.requests();
 s.vscode.window.showQuickPick=async()=>undefined;await s.connection.switchProject();assert.equal(s.requests(),before);
 s.vscode.window.showQuickPick=async()=>{await s.connection.disconnect();return {organization:{id:org,name:'Organization',locked:false}};};
 await s.connection.switchProject();assert.equal(s.requests(),before);assert.equal(s.connection.project,undefined);
 }finally{s.connection.dispose();s.restore();}
});

test('shared account gate logs in and selects project once; cancellation prevents continuation',async()=>{
 const s=setup();try {
 assert.equal(await s.connection.ensureProject(),true);assert.equal(s.logins(),1);assert.equal(s.requests(),1);
 assert.equal(await s.connection.ensureProject(),true);assert.equal(s.logins(),1);assert.equal(s.requests(),1);
 await s.connection.disconnect();s.vscode.window.showInformationMessage=async()=>undefined;
 assert.equal(await s.connection.ensureProject(),false);assert.equal(s.logins(),1);
 }finally{s.connection.dispose();s.restore();}
});
test('expired session reconnects through action gate; direct project switch also reconnects',async()=>{
 const s=setup();try {
 await s.connection.ensureProject();s.connection.session.expiresAt=Date.now()-1;
 assert.equal(await s.connection.ensureProject(),true);assert.equal(s.logins(),2);
 s.connection.session.expiresAt=Date.now()-1;await s.connection.switchProject();assert.equal(s.logins(),3);assert.ok(s.connection.connected);
 }finally{s.connection.dispose();s.restore();}
});

test('Models action silently loads dedicated resources without confirmation or progress popup',async()=>{
 const s=setup();try {
 await s.connection.ensureProject();const before=s.requests();
 s.vscode.window.showInformationMessage=async()=>{assert.fail('no dedicated-list confirmation');};
 s.vscode.window.withProgress=async()=>{assert.fail('no dedicated loading popup');};
 await s.connection.loadModels();assert.equal(s.requests(),before+1);assert.equal(s.connection.dedicatedState,'Aucun déploiement');
 }finally{s.connection.dispose();s.restore();}
});
test('disconnect during silent dedicated load aborts request and prevents stale results',async()=>{
 const s=setup();const old=provider.listDedicated;try {
 await s.connection.ensureProject();
 provider.listDedicated=async(_p,_t,signal)=>{await s.connection.disconnect();assert.ok(signal.aborted);return [{id,label:'stale',kind:'dedicated'}];};
 await s.connection.loadModels();assert.equal(s.connection.dedicated.length,0);assert.equal(s.connection.project,undefined);assert.equal(s.connection.dedicatedState,'Non chargés');
 }finally{provider.listDedicated=old;s.connection.dispose();s.restore();}
});

test('restart restores valid JWT and user-bound scope without HTTP or browser',async()=>{
 const s=setup();let restored;try {
 await s.connection.login();const before=s.requests();s.connection.dispose();
 restored=s.newConnection();await restored.ready;assert.ok(restored.connected);assert.equal(restored.project.id,id);assert.equal(restored.metadata.organizationId,org);
 assert.equal(s.requests(),before);assert.equal(s.logins(),1);assert.equal(await restored.ensureProject(),true);assert.equal(s.requests(),before);
 await restored.disconnect();assert.equal(s.secrets.size,0);assert.equal(s.state.size,0);
 }finally{restored?.dispose();s.connection.dispose();s.restore();}
});
test('expired/malformed persisted JWT deleted without HTTP, no preference crossover',async()=>{
 const s=setup();let restored;try {
 await s.connection.ready;
 s.secrets.set('scalewayAI.userSession.v1',JSON.stringify({token,userId:org,expiresAt:Date.now()-1}));
 restored=s.newConnection();await restored.ready;await restored.storage;assert.ok(!restored.connected);assert.equal(s.secrets.has('scalewayAI.userSession.v1'),false);assert.equal(s.requests(),0);restored.dispose();
 s.secrets.set('scalewayAI.userSession.v1','invalid json');restored=s.newConnection();await restored.ready;await restored.storage;assert.equal(s.secrets.has('scalewayAI.userSession.v1'),false);restored.dispose();
 s.state.set('scalewayAI.preferences.v1.'+id,{organizationId:org,project:{id,name:'Another user',organizationId:org}});
 await s.connection.login();assert.equal(s.connection.project.name,'Project');assert.equal(s.inputs.length,0);
 }finally{restored?.dispose();s.connection.dispose();s.restore();}
});
test('secure storage failure prevents session persistence and no plaintext fallback',async()=>{
 const s=setup();try {
 await s.connection.ready;s.context.secrets.store=async()=>{throw Error('backend unavailable');};
 await s.connection.login();assert.ok(!s.connection.connected);assert.equal(s.requests(),0);assert.ok(!JSON.stringify([...s.state]).includes(token));assert.equal(s.secrets.has('scalewayAI.userSession.v1'),false);
 }finally{s.connection.dispose();s.restore();}
});
test('logout during delayed secret write removes late credential and prevents resurrection',async()=>{
 const s=setup();try {
 await s.connection.ready;let entered;const started=new Promise(r=>entered=r);let release;const blocked=new Promise(r=>release=r);
 s.context.secrets.store=async(k,v)=>{entered();await blocked;s.secrets.set(k,v);};
 const login=s.connection.login();await started;const logout=s.connection.disconnect();release();await Promise.all([login,logout]);
 assert.ok(!s.connection.connected);assert.equal(s.secrets.has('scalewayAI.userSession.v1'),false);assert.equal(s.requests(),0);
 }finally{s.connection.dispose();s.restore();}
});

test('named organization selector filters locked entries and persists organization name',async()=>{
 const s=setup();const old=provider.listOrganizations;try {
 provider.listOrganizations=async()=>[{id,name:'Locked',locked:true},{id:org,name:'Visible organization',locked:false}];
 const picks=[];s.vscode.window.showQuickPick=async(items,opts)=>{picks.push({items,opts});return items[0];};
 await s.connection.login();assert.equal(picks[0].opts.title,'Choisir une organisation Scaleway');assert.equal(picks[0].items.length,1);assert.equal(picks[0].items[0].label,'Visible organization');
 assert.equal(s.connection.metadata.organizationName,'Visible organization');assert.equal(s.state.get('scalewayAI.preferences.v1.'+org).organizationName,'Visible organization');
 }finally{provider.listOrganizations=old;s.connection.dispose();s.restore();}
});

test('catalog loading separates public offerings/models from existing deployments and keeps failures independent',async()=>{
 const s=setup();const old=provider.listServerless,oldCatalog=provider.listDedicatedCatalog;try {
 await s.connection.ensureProject();const before=s.requests();
 provider.listServerless=async k=>{assert.equal(k,'');return [{id:'model',label:'Model',kind:'serverless',status:'preview'}];};
 provider.listDedicatedCatalog=async(p,k)=>{assert.equal(p.id,id);assert.equal(k,token);return [{id,label:'Dedicated model',kind:'dedicated-catalog'}];};
 await s.connection.loadCatalogs();assert.equal(s.requests(),before);assert.equal(s.connection.serverless.length,1);assert.equal(s.connection.dedicatedCatalog.length,1);assert.equal(s.connection.dedicated.length,0);
 provider.listDedicatedCatalog=async()=>{throw new provider.ReadError('access_denied');};
 await s.connection.loadCatalogs();assert.equal(s.connection.serverless.length,1);assert.equal(s.connection.dedicatedCatalog.length,0);assert.ok(s.connection.dedicatedCatalogState.includes('access_denied'));
 }finally{provider.listServerless=old;provider.listDedicatedCatalog=oldCatalog;s.connection.dispose();s.restore();}
});

test('public catalog is independent from busy account and pending SecretStorage, duplicate reads coalesce',async()=>{
 const s=setup();const old=provider.listServerless;try {
 s.connection.ready=new Promise(()=>{});s.connection.busy=true;
 let count=0;provider.listServerless=async()=>{count++;await new Promise(r=>setTimeout(r,5));return [{id:'public',label:'Public',kind:'serverless'}];};
 await Promise.all([s.connection.loadPublicCatalog(),s.connection.loadPublicCatalog()]);assert.equal(count,1);assert.equal(s.connection.serverless.length,1);assert.equal(s.logins(),0);
 }finally{provider.listServerless=old;s.connection.dispose();s.restore();}
});
