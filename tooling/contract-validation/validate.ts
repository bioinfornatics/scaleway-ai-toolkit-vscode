import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
type Binding = {run_id:string; scope:object; spec_revision:string; prompt_revision:string; data_revision:string; model_revision:string; runtime_instance_id:string; epoch:number};
type Event = {binding:Binding; sequence:number; type:string; data:Record<string,unknown>};
type Case = {name:string; contract:string; valid:boolean; value:unknown};
const root=resolve(process.cwd());
function load(path:string):any{return JSON.parse(readFileSync(resolve(root,path),'utf8'));}
const ajv=new Ajv({strict:true,allErrors:true});
const validators:Record<string,ValidateFunction>={};
for(const name of ['agent-spec','runtime-http','runtime-events','webview-ipc'])validators[name]=ajv.compile(load('contracts/'+name+'/v1/schema.json'));
function canonical(value:any):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function sequenceOk(events:Event[]):boolean{
 if(!events.length || events[0].type!=='run.started')return false;
 const binding=canonical(events[0].binding);let terminal=false,last=0;
 for(const [index,event] of events.entries()){
  if(terminal || canonical(event.binding)!==binding || event.sequence!==last+1)return false;
  if(index && event.type==='run.started')return false;
  last=event.sequence;
  if(event.type==='run.terminal'){
   terminal=true;const d=event.data;
   if(d.state==='succeeded' && (d.output_status!=='complete'||d.remote_outcome!=='completed'||d.usage_status!=='known'||d.reconciliation_required))return false;
   if((d.remote_outcome==='unknown'||d.usage_status==='unknown') && !d.reconciliation_required)return false;
  }
 }
 return terminal;
}
const results:{name:string;valid:boolean}[]=[];
for(const item of load('contracts/fixtures/schema-cases.json') as Case[]){
 const actual=Boolean(validators[item.contract](item.value));if(actual!==item.valid)throw new Error(item.name);
 results.push({name:item.name,valid:actual});
}
for(const item of load('contracts/fixtures/run-sequences.json') as {name:string;valid:boolean;events:Event[]}[]){
 const actual=item.events.every(e=>validators['runtime-events'](e))&&sequenceOk(item.events);
 if(actual!==item.valid)throw new Error(item.name);results.push({name:item.name,valid:actual});
}
console.log(JSON.stringify(results));
