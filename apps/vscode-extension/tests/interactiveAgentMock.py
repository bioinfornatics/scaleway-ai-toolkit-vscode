import sys,types,json,builtins,io,contextlib
source=json.load(sys.stdin)
pkg=types.ModuleType('agent_app');pkg.__path__=[];sys.modules['agent_app']=pkg
factory=types.ModuleType('agent_app.agent');config=types.ModuleType('agent_app.config');sys.modules[factory.__name__]=factory;sys.modules[config.__name__]=config
ns={'__name__':'agent_app.interactive','__package__':'agent_app'}
calls=[];checks=[]
def build(**kwargs):
 calls.append(('build',kwargs))
 def agent(message):
  calls.append(('message',message));return 'safe reply'
 return agent
factory.build_agent=build;config.load_project_config=lambda:checks.append(True)
exec(source,ns)
for values in [[],['','  ','EXIT'],[EOFError],[KeyboardInterrupt],['x'*8001,'exit'],['one','two','exit']]:
 calls.clear();it=iter(values)
 def read(prompt):
  try:v=next(it)
  except StopIteration:raise EOFError
  if isinstance(v,type) and issubclass(v,BaseException):raise v
  return v
 builtins.input=read
 with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):assert ns['main'](['--interactive'])==0
 assert len([x for x in calls if x[0]=='build'])==(1 if values==['one','two','exit'] else 0),calls
 if values==['one','two','exit']:assert [x[1] for x in calls if x[0]=='message']==['one','two']
calls.clear()
for args in [[],['--help'],['--check']]:
 with contextlib.redirect_stdout(io.StringIO()):
  try:assert ns['main'](args)==0
  except SystemExit as e:assert e.code==0
assert calls==[] and checks==[True]
ns['build_agent']=lambda **kw: (_ for _ in ()).throw(RuntimeError('SECRET PROVIDER PAYLOAD'))
builtins.input=lambda _: 'message'
out=io.StringIO()
with contextlib.redirect_stderr(out):assert ns['main'](['--interactive'])==1
assert 'SECRET' not in out.getvalue()
print('mock loop PASS')
