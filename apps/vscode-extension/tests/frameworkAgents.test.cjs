const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { transformSync } = require('esbuild');
const { loadEmbeddedTemplates } = require('../dist/embeddedTemplates');
const { withEndpointLaunch } = require('../dist/endpointAgent');
const entries = ['stack', 'builtin']
  .flatMap((usage) => loadEmbeddedTemplates('agents', usage))
  .filter((e) => e.category === 'agent');
const env =
  "SCW_INFERENCE_BASE_URL='https://example.invalid/v1'\nSCW_INFERENCE_MODEL_ID='test-model'\nSCW_API_KEY='offline-key'\n";
for (const entry of entries)
  test(
    entry.template.id +
      ' uses its actual framework with explicit endpoint and no call on import/check',
    async (t) => {
      const files = entry.template.files;
      const prepared = withEndpointLaunch(entry.template, entry.language);
      const launch = JSON.parse(
        prepared.files['.vscode/scaleway-agent-run.json'],
      );
      assert.equal(launch.ready, true);
      assert.equal(prepared.files['scaleway_agent.py'], undefined);
      assert.equal(prepared.files['scaleway_agent.cjs'], undefined);
      if (entry.language === 'python') {
        assert.equal(launch.entry, 'src/agent_app/agent.py');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-agent-'));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        for (const [name, content] of Object.entries(files)) {
          const p = path.join(root, name);
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, content);
        }
        fs.writeFileSync(path.join(root, '.env'), env);
        const cleanEnv = { ...process.env };
        for (const name of Object.keys(cleanEnv))
          if (name.startsWith('SCW_')) delete cleanEnv[name];
        const check = spawnSync(
          'python3',
          [path.join(root, launch.entry), '--check'],
          { encoding: 'utf8', env: cleanEnv },
        );
        assert.equal(check.status, 0, check.stderr);
        const harness = [
          'import sys,types,runpy',
          'class Model:',
          ' def __init__(self,**kwargs):',
          '  values=kwargs.get("client_args",kwargs)',
          '  assert values["base_url"] == "https://example.invalid/v1"',
          '  assert values["api_key"] == "offline-key"',
          '  assert kwargs.get("model_id",kwargs.get("model")) == "test-model"',
          'class Agent:',
          ' def __init__(self,**kwargs): assert kwargs["tools"] == []',
          ' def __call__(self,prompt): assert prompt == "hello"; return "mock-result"',
          ' def invoke(self,request): assert request["messages"][0]["content"] == "hello"; return {"messages":[types.SimpleNamespace(content="mock-result")]}',
          'def create_agent(**kwargs): return Agent(**kwargs)',
          'for name in ["strands","strands.models","strands.models.openai","langchain","langchain.agents","langchain_openai"]: sys.modules[name]=types.ModuleType(name)',
          'sys.modules["strands"].Agent=Agent',
          'sys.modules["strands.models.openai"].OpenAIModel=Model',
          'sys.modules["langchain.agents"].create_agent=create_agent',
          'sys.modules["langchain_openai"].ChatOpenAI=Model',
          'sys.argv=[sys.argv[1],"hello"]',
          'runpy.run_path(sys.argv[0],run_name="__main__")',
        ].join(String.fromCharCode(10));
        const run = spawnSync(
          'python3',
          ['-c', harness, path.join(root, launch.entry)],
          { encoding: 'utf8', env: cleanEnv },
        );
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout.trim(), 'mock-result');
      } else {
        assert.equal(launch.entry, 'dist/agent.js');
        const options = [];
        let invoked = 0;
        class Model {
          constructor(value) {
            options.push(value);
          }
        }
        class Agent {
          constructor(value) {
            options.push(value);
          }
          async invoke(_value) {
            invoked++;
            return entry.framework === 'langchain'
              ? { messages: [{ content: 'mock-result' }] }
              : 'mock-result';
          }
          async generate(_value) {
            invoked++;
            return { text: 'mock-result' };
          }
        }
        const config = {
          endpoint: 'https://example.invalid/v1',
          modelId: 'test-model',
          key: 'offline-key',
        };
        let source = files['src/agent.ts'];
        source = source.slice(0, source.indexOf('if (process.argv[1]'));
        source = source.replace(/await import\(/g, 'await mocks(');
        const code = transformSync(source, {
          loader: 'ts',
          format: 'cjs',
        }).code;
        const mod = { exports: {} };
        const proc = {
          argv: ['node', 'agent', 'hello'],
          env: { SCW_API_KEY: 'offline-key' },
        };
        vm.runInNewContext(code, {
          module: mod,
          exports: mod.exports,
          process: proc,
          console: { log() {} },
          require: (name) =>
            name === './config.js'
              ? { loadConfig: () => config }
              : require(name),
          mocks: async () => ({
            Agent,
            OpenAIModel: Model,
            ChatOpenAI: Model,
            createAgent: (value) => new Agent(value),
          }),
        });
        assert.equal(invoked, 0);
        await mod.exports.main();
        assert.equal(invoked, 1);
        const serialized = JSON.stringify(options);
        assert.ok(serialized.includes('https://example.invalid/v1'));
        assert.ok(serialized.includes('offline-key'));
        assert.ok(serialized.includes('test-model'));
        proc.argv = ['node', 'agent', '--check'];
        await mod.exports.main();
        assert.equal(invoked, 1);
      }
    },
  );
