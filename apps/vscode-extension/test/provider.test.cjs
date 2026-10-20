const assert=require("node:assert/strict");
const {test}=require("node:test");
const {listProjects,listServerless,listDedicated,getJSON,ReadError,sessionHeaders}=require("../dist/provider");
const org="11111111-1111-1111-1111-111111111111", id="22222222-2222-2222-2222-222222222222";
const key="eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj";
const signal=()=>new AbortController().signal;
test("projects scoped GET and normalized safe fields",async()=>{
 let count=0;const rows=await listProjects(org,key,signal(),async(origin,path,k)=>{count++;assert.equal(origin,"control");assert.ok(path.includes("organization_id="+org));assert.equal(k,key);return {projects:[{id,name:"Test",organization_id:org,secret:"omit"}],total_count:1};});
 assert.equal(count,1);assert.deepEqual(rows,[{id,name:"Test",organizationId:org}]);
});
test("foreign project and malformed response reject instead of empty",async()=>{
 await assert.rejects(listProjects(org,key,signal(),async()=>({projects:[{id,name:"Test",organization_id:id}],total_count:1})),{code:"foreign_or_invalid_scope"});
 await assert.rejects(listServerless(key,signal(),async()=>({error:"private error"})),{code:"serverless_jwt_unverified"});
});
test("serverless JWT dispatch disabled; control JWT uses SDK session header",async()=>{
 let sends=0;await assert.rejects(listServerless(key,signal(),async()=>{sends++;}),{code:'serverless_jwt_unverified'});assert.equal(sends,0);
 assert.deepEqual(sessionHeaders(key),{'X-Session-Token':key,Accept:'application/json'});
 await assert.rejects(getJSON('models','/v1/models',key,signal()),{code:'invalid_request'});
 assert.throws(()=>sessionHeaders('api_key'),{code:'invalid_request'});
});
test("dedicated deployments require exact project and region",async()=>{
 const project={id,name:"Test",organizationId:org};
 await assert.rejects(listDedicated(project,key,signal(),async()=>({deployments:[{id,name:"Deployment",project_id:org,region:"fr-par"}],total_count:1})),{code:"foreign_or_invalid_scope"});
 assert.deepEqual(await listDedicated(project,key,signal(),async()=>({deployments:[],total_count:0})),[]);
});
test("pagination has hard five-send ceiling",async()=>{
 let sends=0;await assert.rejects(listProjects(org,key,signal(),async()=>{sends++;return {projects:Array.from({length:100},()=>({id,name:"Test",organization_id:org})),total_count:1000};}),{code:"page_limit"});
 assert.equal(sends,5);
});
test("already cancelled dispatch and unknown routes never send",async()=>{
 const c=new AbortController();c.abort();
 await assert.rejects(getJSON("models","/v1/models",key,c.signal),{code:"cancelled"});
 await assert.rejects(getJSON("models","/v1/chat/completions",key,signal()),{code:"invalid_request"});
 await assert.rejects(getJSON("control","/account/v3/projects?evil=x",key,signal()),{code:"invalid_request"});
});
