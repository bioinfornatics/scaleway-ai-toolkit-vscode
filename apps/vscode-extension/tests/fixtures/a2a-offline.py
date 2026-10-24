import sys,types,json,asyncio,ast
from pathlib import Path
root=Path(sys.argv[1])
for p in root.rglob('*.py'): ast.parse(p.read_text())
names=['a2a','a2a.server','a2a.server.agent_execution','a2a.server.routes','a2a.server.request_handlers','a2a.server.tasks','a2a.types','a2a.types.a2a_pb2','a2a.utils','a2a.utils.errors','fastapi']
for name in names: sys.modules[name]=types.ModuleType(name)
class Obj:
 def __init__(self,**kw): self.__dict__.update(kw)
class Error(Exception):
 def __init__(self,message): super().__init__(message)
sys.modules['a2a.server.agent_execution'].AgentExecutor=object
for n in ['Message','Part','AgentCard','AgentCapabilities','AgentInterface','AgentSkill']: setattr(sys.modules['a2a.types.a2a_pb2'],n,Obj)
sys.modules['a2a.types.a2a_pb2'].ROLE_USER=1
sys.modules['a2a.types.a2a_pb2'].ROLE_AGENT=2
for n in ['InvalidParamsError','UnsupportedOperationError','InternalError']: setattr(sys.modules['a2a.utils.errors'],n,Error)
sys.modules['fastapi'].FastAPI=Obj
sys.modules['a2a.server.request_handlers'].DefaultRequestHandler=Obj
sys.modules['a2a.server.tasks'].InMemoryTaskStore=object
routes=sys.modules['a2a.server.routes']
routes.create_agent_card_routes=lambda card: [card]
routes.create_jsonrpc_routes=lambda handler,rpc_url: [handler,rpc_url]
def mount(api,**kw): api.routes=kw
routes.add_a2a_routes_to_fastapi=mount
sys.path.insert(0,str(root/'src'))
from agent_app import a2a_executor as ex,service_api as api
app=api.create_app(3333)
assert app.app.routes['agent_card_routes'][0].supported_interfaces[0].url=='http://127.0.0.1:3333/a2a'
assert not app.app.routes['agent_card_routes'][0].capabilities.streaming
calls=[]
class Agent:
 async def invoke_async(self,text): calls.append(text);return 'mock reply'
class Client:
 async def aclose(self): calls.append('closed')
original_builder=ex.build_request_agent
ex.build_request_agent=lambda: (Agent(),Client())
async def main():
 events=[]
 class Queue:
  async def enqueue_event(self,event): events.append(event)
 part=Obj(text='hello',WhichOneof=lambda name: 'text' if name == 'content' else None,metadata=Obj(ListFields=lambda: []),filename='',media_type='')
 context=Obj(message=Obj(role=1,parts=[part],extensions=[],reference_task_ids=[],metadata=Obj(ListFields=lambda: [])),context_id='ctx')
 await ex.StrandsExecutor().execute(context,Queue())
 await ex.StrandsExecutor().execute(context,Queue())
 assert calls==['hello','closed','hello','closed'] and len(events)==2
 assert events[0].parts[0].text=='mock reply' and events[0].message_id!=events[1].message_id
 context.message.parts=[part,part]
 try: await ex.StrandsExecutor().execute(context,Queue());assert False
 except Error: pass
 assert len(calls)==4
 context.message.parts=[part]
 try: await ex.StrandsExecutor().cancel(context,Queue());assert False
 except Error: pass
 # Public errors are fixed and every created client closes, including cancellation.
 baseline = len(calls)
 class BrokenAgent:
  async def invoke_async(self,text):
   calls.append('broken')
   raise RuntimeError('offline-secret')
 class EmptyAgent:
  async def invoke_async(self,text): calls.append('empty'); return ' '
 class HugeAgent:
  async def invoke_async(self,text): calls.append('huge'); return 'x'*32001
 class SlowAgent:
  async def invoke_async(self,text):
   calls.append('slow')
   await asyncio.sleep(1)
 real_wait = asyncio.wait_for
 for cls in [BrokenAgent,EmptyAgent,HugeAgent,SlowAgent]:
  before = len(calls)
  ex.build_request_agent=lambda cls=cls: (cls(),Client())
  async def short_wait(coro,timeout): return await real_wait(coro,.001)
  ex.asyncio.wait_for=short_wait
  try:
   await ex.StrandsExecutor().execute(context,Queue())
   assert False
  except Error as error: assert str(error)=='agent_unavailable' and 'offline-secret' not in str(error)
  finally: ex.asyncio.wait_for=real_wait
  assert len(calls)==before+2 and calls[-1]=='closed' and len(events)==2
 before=len(calls)
 ex.build_request_agent=lambda: (SlowAgent(),Client())
 task=asyncio.create_task(ex.StrandsExecutor().execute(context,Queue()))
 await asyncio.sleep(0)
 task.cancel()
 try: await task;assert False
 except asyncio.CancelledError: pass
 assert calls[-1]=='closed' and len(events)==2
 # Metadata checks use protobuf ListFields, not object truthiness.
 from google.protobuf.struct_pb2 import Struct
 metadata=Struct(); assert metadata.ListFields()==[]
 context.message.metadata=metadata
 ex.build_request_agent=lambda: (Agent(),Client())
 await ex.StrandsExecutor().execute(context,Queue())
 metadata.update({'forbidden':True})
 before=len(calls)
 try: await ex.StrandsExecutor().execute(context,Queue());assert False
 except Error: pass
 assert len(calls)==before
 context.message.metadata=Struct()
 print('executor success/error/empty/oversize/timeout/cancel/metadata: PASS (8 executions, all allocated clients closed)')
 # Real HTTPX, mock network transport; authored builder really receives the bounded client.
 import httpx,os
 assert httpx.__version__=='0.28.1', httpx.__version__
 from agent_app import agent as authored
 sys.modules['strands']=types.ModuleType('strands')
 sys.modules['strands.models']=types.ModuleType('strands.models')
 sys.modules['strands.models.openai']=types.ModuleType('strands.models.openai')
 models=[];agents=[];upstream=[];responses=[];transports=[]
 class Model:
  def __init__(self,**kw): self.kw=kw;models.append(self)
 class AuthoredAgent:
  def __init__(self,**kw): self.kw=kw;agents.append(self)
 sys.modules['strands'].Agent=AuthoredAgent
 sys.modules['strands.models.openai'].OpenAIModel=Model
 class Stream(httpx.AsyncByteStream):
  def __init__(self,chunks): self.chunks=chunks; self.closed=False
  async def __aiter__(self):
   for chunk in self.chunks: yield chunk
  async def aclose(self): self.closed=True
 class Inner:
  mode='ok'
  def __init__(self,**kw):
   assert kw=={'retries':0,'trust_env':False}
   self.closed=False;transports.append(self)
  async def handle_async_request(self,request):
   upstream.append(str(request.url))
   stream=Stream([b'x'*32768,b'x'*32769] if self.mode=='large' else [b'{}'])
   responses.append(stream)
   return httpx.Response(302 if self.mode=='redirect' else 500 if self.mode=='error' else 200,stream=stream,headers={'content-encoding':'gzip'} if self.mode=='compressed' else {})
  async def aclose(self): self.closed=True
 saved=httpx.AsyncHTTPTransport; httpx.AsyncHTTPTransport=Inner
 try:
  for mode in ['ok','large','redirect','error','compressed']:
   Inner.mode=mode
   agent,client=original_builder()
   assert agent is agents[-1] and agent.kw['system_prompt']=='You are a helpful assistant.'
   assert models[-1].kw['client_args']['http_client'] is client
   assert models[-1].kw['params']=={'max_tokens':1024} and models[-1].kw['stream'] is False
   assert models[-1].kw['client_args']['max_retries']==0
   before=len(upstream)
   for url,method in [('https://evil.invalid/v1/chat/completions','POST'),('https://example.invalid/v1/chat/completions','GET')]:
    try: await client.request(method,url);assert False
    except ValueError as e: assert str(e)=='upstream_not_allowed'
   assert len(upstream)==before
   try:
    r=await client.post('https://example.invalid/v1/chat/completions',json={})
    assert mode=='ok' and r.content==b'{}'
   except ValueError: assert mode!='ok'
   assert len(upstream)==before+1 and responses[-1].closed
   await client.aclose(); assert transports[-1].closed
  # URL-object comparisons preserve HTTPX host/scheme/default-port normalization.
  Inner.mode='ok'
  old_endpoint=os.environ['SCW_INFERENCE_BASE_URL']
  for endpoint in ['https://EXAMPLE.invalid/v1','https://example.invalid:443/v1','HTTPS://example.invalid/v1']:
   os.environ['SCW_INFERENCE_BASE_URL']=endpoint
   agent,client=original_builder()
   before=len(upstream)
   for url,method in [('https://evil.invalid/v1/chat/completions','POST'),('https://example.invalid/v2/chat/completions','POST'),('https://example.invalid/v1/chat/completions?x=1','POST'),('http://example.invalid/v1/chat/completions','POST'),('https://example.invalid/v1/chat/completions','GET')]:
    try: await client.request(method,url);assert False
    except ValueError as error: assert str(error)=='upstream_not_allowed'
   assert len(upstream)==before
   response=await client.post('https://example.invalid/v1/chat/completions',json={})
   assert response.content==b'{}' and len(upstream)==before+1 and responses[-1].closed
   await client.aclose();assert transports[-1].closed
  os.environ['SCW_INFERENCE_BASE_URL']=old_endpoint
  # Builder construction failure still transfers cleanup ownership to executor.
  def broken_builder(**kw): raise RuntimeError('offline-secret')
  old=authored.build_agent;authored.build_agent=broken_builder
  agent,client=original_builder();assert agent is None
  await client.aclose();assert transports[-1].closed
  authored.build_agent=old
 finally: httpx.AsyncHTTPTransport=saved
 print('authored builder + real HTTPX/mock upstream: PASS (HTTPX 0.28.1; 5 response scenarios + 3 normalized endpoints, 25 no-dispatch guards, 9 transports closed)')
 accepted=[]
 async def downstream(scope,receive,send): accepted.append(json.loads((await receive())['body']))
 gate=api.LocalSurface(downstream)
 good={'jsonrpc':'2.0','id':'1','method':'SendMessage','params':{'message':{'messageId':'m','role':'ROLE_USER','parts':[{'text':'hello'}]}}}
 async def request(payload=good,**changes):
  scope=dict(type='http',method='POST',path='/a2a',scheme='http',server=('127.0.0.1',3001),client=('127.0.0.1',123),headers=[(b'host',b'127.0.0.1:3001'),(b'content-type',b'application/json'),(b'a2a-version',b'1.0')],query_string=b'')
  scope.update(changes); sent=[]
  async def receive():return {'type':'http.request','body':json.dumps(payload).encode(),'more_body':False}
  async def send(item):sent.append(item)
  await gate(scope,receive,send)
  return sent
 await request();assert accepted==[good]
 base_headers=[(b'host',b'127.0.0.1:3001'),(b'content-type',b'application/json')]
 for versions in [[],[b'0.3'],[b'2.0'],[b'1.0',b'1.0']]:
  response=await request(headers=base_headers+[(b'A2A-Version',v) for v in versions])
  body=json.loads(response[1]['body'])
  assert body['error']['code']==-32009 and body['error']['message']=='version_not_supported' and 'result' not in body and len(accepted)==1
 assert (await request(headers=base_headers+[(b'A2A-Version',b'1.0')]))==[]
 assert len(accepted)==2
 accepted.pop()
 for method in ['SendStreamingMessage','CancelTask','GetTask','ListTasks','SetTaskPushNotificationConfig','message/send']:
  bad=dict(good,method=method);r=await request(bad);assert json.loads(r[1]['body'])['error']['code']==-32601 and len(accepted)==1
 for parts in [[],[{'url':'https://evil.invalid'}],[{'raw':'AAAA'}],[{'data':{}}],[{'text':'a'},{'text':'b'}],[{'text':'x'*8001}],[{'text':'  '}]]:
  bad=json.loads(json.dumps(good));bad['params']['message']['parts']=parts
  assert (await request(bad))[0]['status']==200 and len(accepted)==1
 for change in [dict(client=('10.0.0.1',1)),dict(headers=[(b'host',b'evil')]),dict(headers=[(b'host',b'127.0.0.1:3001'),(b'origin',b'null')]),dict(query_string=b'x'),dict(scheme='https')]:
  assert (await request(**change))[0]['status']==403
 assert (await request(path='/api/chat'))[0]['status']==404
 assert (await request(dict(good,extra='x'*33000)))[0]['status']==413
 assert len(accepted)==1
 # Body deadline and concurrency reject before downstream, counter resets.
 gate.body_timeout=.001
 scope=dict(type='http',method='POST',path='/a2a',scheme='http',server=('127.0.0.1',3001),client=('127.0.0.1',1),headers=[(b'host',b'127.0.0.1:3001'),(b'content-type',b'application/json'),(b'a2a-version',b'1.0')],query_string=b'')
 sent=[]
 async def send(item):sent.append(item)
 async def slow_receive():await asyncio.sleep(1)
 await gate(scope,slow_receive,send)
 assert sent[0]['status']==408 and len(accepted)==1 and gate.active==0
 # Occupy slots with incomplete bodies, then submit a fifth request.
 gate.body_timeout=1
 blocked=asyncio.Event()
 async def blocked_receive(): await blocked.wait()
 tasks=[asyncio.create_task(gate(scope,blocked_receive,send)) for _ in range(4)]
 await asyncio.sleep(.001)
 assert gate.active==4
 assert (await request())[0]['status']==429 and len(accepted)==1
 for task in tasks:task.cancel()
 await asyncio.gather(*tasks,return_exceptions=True)
 assert gate.active==0
 print('ASGI route/method/input/host/body/concurrency/version guards: PASS (zero extra dispatches)')
async def cleanup_regression():
 # Execute actual public-tag handler/active/registry methods with fake collaborators.
 # SDK protobuf structs, subscription and JSON-RPC body parser remain mocked.
 import threading,typing,logging
 source=Path(__file__).with_name('a2a-sdk-cleanup.py').read_text()
 ns=dict(asyncio=asyncio,logger=logging.getLogger('offline'),cast=typing.cast,
  Message=Obj,Task=type('Task',(),{}),TaskState=Obj(TASK_STATE_FAILED=9),
  TERMINAL_TASK_STATES=set(),INTERRUPTED_TASK_STATES=set(),apply_history_length=lambda result,config:result,
  InternalError=Error)
 class JSONRPCError:
  def __init__(self,**kw):self.kw=kw
  def model_dump(self,exclude_none):return self.kw
 class JSONRPCResponse:
  def __init__(self,error,_id):self.data={'jsonrpc':'2.0','id':_id,'error':error}
 ns.update(JSONRPCError=JSONRPCError,JSONRPCInternalError=JSONRPCError,
  A2AError=Error,EXCEPTION_MAP={Error:JSONRPCError},JSON_RPC_ERROR_CODE_MAP={Error:-32603},
  build_error_details=lambda error:[],JSONRPC20Response=JSONRPCResponse)
 exec('from __future__ import annotations\n'+source,ns)
 registries=[];queues=[];tasks=[]
 class FakeQueue:
  def __init__(self):self.closed=False;self.events=[];queues.append(self)
  def shutdown(self,immediate):assert immediate;self.closed=True
  async def close(self,immediate):assert immediate;self.closed=True
  async def enqueue_event(self,event):self.events.append(event)
 class Active(ns['ExtractedActive']):
  async def subscribe(self,request,**kw):
   self._producer_task=asyncio.create_task(self.executor.execute(request,self._event_queue_agent))
   self._consumer_task=asyncio.create_task(asyncio.sleep(60))
   tasks.extend([self._producer_task,self._consumer_task])
   await self._producer_task
   for event in self._event_queue_agent.events:yield event
  async def get_task(self):return None
 class Registry(ns['ExtractedRegistry']):
  def __init__(self):
   self._lock=threading.RLock();self._active_tasks={};self._cleanup_tasks=set();registries.append(self)
 class Handler(ns['ExtractedHandler']):
  def __init__(self,agent_executor,task_store,agent_card):
   self.agent_executor=agent_executor;self._active_task_registry=Registry()
  async def _setup_active_task(self,params,context):
   active=Active();active.executor=self.agent_executor
   active._request_queue=FakeQueue();active._event_queue_agent=FakeQueue();active._event_queue_subscribers=FakeQueue()
   active._lock=asyncio.Lock();active._is_finished=asyncio.Event();active._producer_task=None;active._consumer_task=None
   self._active_task_registry._active_tasks['t']=active
   return active,context
 api.DefaultRequestHandler=Handler
 wrapper=api.ImmediateRequestHandler(agent_executor=ex.StrandsExecutor(),task_store=object(),agent_card=object())
 params=Obj(message=Obj(task_id=''),configuration=Obj(return_immediately=False))
 part=Obj(text='hello',WhichOneof=lambda _: 'text',metadata=Obj(ListFields=lambda:[]),filename='',media_type='')
 context=Obj(task_id='t',context_id='ctx',message=Obj(role=1,parts=[part],extensions=[],reference_task_ids=[],metadata=Obj(ListFields=lambda:[])))
 class Failed:
  async def invoke_async(self,text):raise RuntimeError('offline-secret')
 class Slow:
  async def invoke_async(self,text):await asyncio.sleep(60)
 real_wait=asyncio.wait_for
 for mode in ['success']+['failure','timeout','cancel']*5:
  before=len(queues);before_tasks=len(tasks)
  ex.build_request_agent=lambda: (Agent() if mode=='success' else Failed() if mode=='failure' else Slow(),Client())
  if mode=='timeout':
   async def short_wait(coro,timeout):return await real_wait(coro,.001)
   ex.asyncio.wait_for=short_wait
  try:
   task=asyncio.create_task(wrapper.on_message_send(params,context))
   if mode=='cancel':
    await asyncio.sleep(.001);task.cancel()
   try:
    result=await real_wait(task,1)
    assert mode=='success' and result.parts[0].text=='mock reply'
   except Error as error:
    assert mode in ['failure','timeout'] and str(error)=='agent_unavailable'
    response=ns['build_error_response']('request-1',error)
    assert response=={'jsonrpc':'2.0','id':'request-1','error':{'code':-32603,'message':'agent_unavailable','data':[]}}
    assert 'result' not in response and 'offline-secret' not in json.dumps(response)
   except asyncio.CancelledError:assert mode=='cancel'
  finally:ex.asyncio.wait_for=real_wait
  assert all(queue.closed for queue in queues[before:])
  assert all(task.done() for task in tasks[before_tasks:])
  assert all(len(registry._active_tasks)==0 for registry in registries)
  assert calls[-1]=='closed'
 print('actual pinned V2 handler + public aclose/registry/active extracted methods: PASS (16 requests; repeated failures/timeouts/cancel; all queues closed, producers done, registry count 0; actual error-response builder with mocked models; NOT installed SDK proof)')
asyncio.run(main())
asyncio.run(cleanup_regression())
print('A2A offline executor/factory/security: PASS')
