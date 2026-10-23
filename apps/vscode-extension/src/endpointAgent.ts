import { parseTemplate, type TemplateDefinition } from './templateLibrary';

const python =
  '"""Minimal Scaleway endpoint client. Run --check without an inference call."""\nimport json\nimport os\nfrom pathlib import Path\nimport sys\nimport urllib.request\nfrom urllib.parse import urlsplit\n\ndef main():\n    for line in (Path(__file__).parent / ".env").read_text().splitlines():\n        if not line.strip() or line.lstrip().startswith("#"):\n            continue\n        key, value = line.split("=", 1)\n        os.environ.setdefault(key.strip(), value.strip().strip(chr(39) + chr(34)))\n    base = os.environ.get("SCW_INFERENCE_BASE_URL", "").rstrip("/")\n    model = os.environ.get("SCW_INFERENCE_MODEL_ID", "")\n    key = os.environ.get("SCW_API_KEY", "")\n    url = urlsplit(base)\n    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or not model or not key:\n        raise ValueError("Configuration endpoint, modèle ou clé manquante/invalide")\n    if sys.argv[1:] == ["--check"]:\n        print("Configuration locale présente ; aucun appel réseau effectué.")\n        return\n    prompt = " ".join(sys.argv[1:]) or "Bonjour"\n    data = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}]}).encode()\n    headers = {"Content-Type": "application/json"}\n    headers.update(zip(["Authorization"], [" ".join(["Bearer", key])]))\n    request = urllib.request.Request(base + "/chat/completions", data=data, headers=headers)\n    class NoRedirect(urllib.request.HTTPRedirectHandler):\n        def redirect_request(self, *args, **kwargs):\n            return None\n    with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:\n        result = json.load(response)\n    print(result["choices"][0]["message"]["content"])\n\nif __name__ == "__main__":\n    try:\n        main()\n    except Exception:\n        print("Échec de l’appel : vérifiez configuration, accès et endpoint.", file=sys.stderr)\n        sys.exit(1)\n';
const node =
  '// Minimal Scaleway endpoint client. Node.js 22+, no package installation.\nconst fs = require("node:fs");\nconst path = require("node:path");\n\nasync function main() {\n  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\\r?\\n/)) {\n    if (!line.trim() || line.trimStart().startsWith("#")) continue;\n    const split = line.indexOf("=");\n    if (split < 1) throw new Error("invalid env");\n    const key = line.slice(0, split).trim();\n    const value = line.slice(split + 1).trim().replace(/^[\'"]|[\'"]$/g, "");\n    if (process.env[key] === undefined) process.env[key] = value;\n  }\n  const base = (process.env.SCW_INFERENCE_BASE_URL || "").replace(/\\/$/, "");\n  const model = process.env.SCW_INFERENCE_MODEL_ID;\n  const key = process.env.SCW_API_KEY;\n  const url = new URL(base);\n  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !model || !key) throw new Error("invalid config");\n  if (process.argv.slice(2).join(" ") === "--check") {\n    console.log("Configuration locale présente ; aucun appel réseau effectué.");\n    return;\n  }\n  const prompt = process.argv.slice(2).join(" ") || "Bonjour";\n  const response = await fetch(base + "/chat/completions", {\n    method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),\n    headers: Object.fromEntries([["Authorization", ["Bearer", key].join(" ")], ["Content-Type", "application/json"]]),\n    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),\n  });\n  if (!response.ok) throw new Error("endpoint failure");\n  const result = await response.json();\n  console.log(result.choices[0].message.content);\n}\nmain().catch(() => { console.error("Échec de l’appel : vérifiez configuration, accès et endpoint."); process.exitCode = 1; });\n';

/** Only creation of host-owned projects opts in; personal payloads stay untouched. */
export function withEndpointLaunch(
  template: TemplateDefinition,
  language: string,
): TemplateDefinition {
  if (
    template.kind === 'agents' &&
    language === 'rust' &&
    template.files['Cargo.toml']
  )
    return withRustWorkspace(template);
  if (
    template.kind !== 'agents' ||
    !['python', 'typescript'].includes(language)
  )
    return template;
  const files = { ...template.files };
  const frameworkEntry =
    language === 'python'
      ? files['src/agent_app/agent.py']
        ? 'src/agent_app/agent.py'
        : undefined
      : files['src/agent-sdk.ts']
        ? 'dist/agent-sdk.js'
        : files['src/agent.ts'] &&
            /buildAgent/.test(files['src/agent.ts']) &&
            /@strands-agents|langchain|@mastra/.test(files['src/agent.ts'])
          ? 'dist/agent.js'
          : undefined;
  const entry =
    frameworkEntry ??
    (language === 'python' ? 'scaleway_agent.py' : 'scaleway_agent.cjs');
  if (!frameworkEntry && Object.hasOwn(files, entry))
    throw new Error('endpoint_entry_conflict');
  if (!frameworkEntry) files[entry] = language === 'python' ? python : node;
  files['.vscode/scaleway-agent-run.json'] = JSON.stringify(
    {
      version: 1,
      ready: true,
      runtime: language === 'python' ? 'python' : 'node',
      entry,
      args: [],
    },
    null,
    2,
  );
  if (language === 'python' && files['pyproject.toml']) {
    files['.vscode/settings.json'] = JSON.stringify(
      {
        'python.defaultInterpreterPath': '${workspaceFolder}/.venv',
        'python.terminal.activateEnvironment': true,
        'python.testing.pytestEnabled': true,
        'python.testing.unittestEnabled': false,
        'python.testing.pytestArgs': ['tests'],
        'python.testing.cwd': '${workspaceFolder}',
      },
      null,
      2,
    );
    files['.vscode/extensions.json'] = JSON.stringify(
      {
        recommendations: [
          'ms-python.python',
          'ms-python.vscode-pylance',
          'ms-python.debugpy',
        ],
      },
      null,
      2,
    );
    files['.vscode/launch.json'] = JSON.stringify(
      {
        version: '0.2.0',
        configurations: [
          {
            name: 'Déboguer l’agent',
            type: 'debugpy',
            request: 'launch',
            program: '${workspaceFolder}/' + entry,
            python: '${workspaceFolder}/.venv/bin/python',
            windows: { python: '${workspaceFolder}/.venv/Scripts/python.exe' },
            cwd: '${workspaceFolder}',
            console: 'integratedTerminal',
            justMyCode: true,
          },
        ],
      },
      null,
      2,
    );
  }
  if (language === 'typescript' && files['package.json']) {
    const pkg = JSON.parse(files['package.json']);
    pkg.scripts = {
      ...pkg.scripts,
      test: pkg.scripts?.test ?? 'node --test tests/scaleway-project.test.cjs',
    };
    files['package.json'] = JSON.stringify(pkg, null, 2);
    if (files['tsconfig.json']) {
      const config = JSON.parse(files['tsconfig.json']);
      config.compilerOptions = {
        ...config.compilerOptions,
        rootDir: 'src',
        sourceMap: true,
        inlineSources: true,
      };
      files['tsconfig.json'] = JSON.stringify(config, null, 2);
    }
    const moduleEntry = frameworkEntry ?? 'dist/agent.js';
    files['tests/scaleway-project.test.cjs'] =
      'const { test } = require("node:test");\nconst assert = require("node:assert/strict");\nconst { pathToFileURL } = require("node:url");\nconst path = require("node:path");\ntest("Agent module imports without invoking the model", async () => {\n  const agent = await import(pathToFileURL(path.join(__dirname, "../' +
      moduleEntry +
      '")));\n  assert.equal(typeof agent.buildAgent, "function");\n});\n';
    files['.vscode/settings.json'] = JSON.stringify(
      {
        'typescript.tsdk': 'node_modules/typescript/lib',
        'typescript.enablePromptUseWorkspaceTsdk': true,
      },
      null,
      2,
    );
    files['.vscode/extensions.json'] = JSON.stringify(
      { recommendations: ['oven.bun-vscode'] },
      null,
      2,
    );
    files['.vscode/tasks.json'] = JSON.stringify(
      {
        version: '2.0.0',
        tasks: [
          {
            label: 'Construire le projet',
            type: 'process',
            command: 'bun',
            args: ['run', 'build'],
            options: { cwd: '${workspaceFolder}' },
            problemMatcher: '$tsc',
            group: 'build',
          },
          {
            label: 'Tester le projet',
            type: 'process',
            command: 'bun',
            args: ['run', 'test'],
            options: { cwd: '${workspaceFolder}' },
            problemMatcher: [],
            group: 'test',
          },
        ],
      },
      null,
      2,
    );
    files['.vscode/launch.json'] = JSON.stringify(
      {
        version: '0.2.0',
        configurations: [
          {
            name: 'Déboguer l’agent',
            type: 'node',
            request: 'launch',
            program: '${workspaceFolder}/' + entry,
            cwd: '${workspaceFolder}',
            preLaunchTask: 'Construire le projet',
            outFiles: ['${workspaceFolder}/dist/**/*.js'],
            sourceMaps: true,
            console: 'integratedTerminal',
            skipFiles: ['<node_internals>/**'],
          },
        ],
      },
      null,
      2,
    );
    files['README.md'] =
      (files['README.md'] ?? '') +
      '\n\n## VS Code et préparation TypeScript\nÀ la création, bun install puis bun run build sont automatiques ; Bun et Node.js doivent être installés. Échec : relancez ces commandes dans le projet. Aucun appel modèle pendant cette préparation.\nLe dossier utilise TypeScript local, source maps, les tâches Construire/Tester le projet et Déboguer l’agent. Tests hors réseau : bun run test (import du module sans invocation, pas une preuve d’inférence). Déboguer l’agent peut appeler le modèle facturé.\n';
  }
  for (const marker of ['agent.authoring.json', 'agent.creation.json']) {
    if (!files[marker]) continue;
    const note = JSON.parse(files[marker]);
    files[marker] = JSON.stringify(
      {
        ...note,
        incomplete: false,
        note: frameworkEntry
          ? 'Selected framework configured for Scaleway endpoint. Install dependencies explicitly; no inference verified.'
          : 'Standalone endpoint client configured. Backend and framework integration belong to the development team. No inference verified.',
      },
      null,
      2,
    );
  }
  if (!frameworkEntry)
    files['README.md'] =
      (files['README.md'] ?? '') +
      '\n\n## Lancement simple Scaleway\nLe point d’entrée autonome consomme le modèle/endpoint du `.env` privé, sans backend ni framework obligatoire. Le backend et les bases de framework restent disponibles pour votre équipe.\nPython 3 ou Node.js 22+ doit être présent. Aucune dépendance supplémentaire pour ce client.\nVérification sans réseau : `' +
      (language === 'python' ? 'python3 ' : 'node ') +
      entry +
      ' --check`.\nLancement : `' +
      (language === 'python' ? 'python3 ' : 'node ') +
      entry +
      ' "Votre message"`. Sans argument, le message est Bonjour. Chaque lancement normal appelle le modèle et peut être facturé. Aucun appel lors de la création.\nCe client utilise l’API chat/completions ; la réponse réelle, les droits et le comportement métier restent à vérifier par votre équipe.\n';
  if (language === 'python' && files['pyproject.toml']) {
    files['README.md'] =
      (files['README.md'] ?? '') +
      '\n\n## VS Code et environnement Python\nÀ la création depuis l’extension, uv sync prépare automatiquement .venv et les dépendances (uv doit être installé ; téléchargements et scripts de dépendances possibles). Aucun appel modèle. En cas d’échec, les fichiers restent disponibles : relancez uv sync dans ce dossier.\nAjoutez ce dossier au workspace : interpréteur local .venv, pytest dans tests/ et configuration « Déboguer l’agent » sont fournis. Acceptez les extensions Python/Pylance/Python Debugger recommandées si elles manquent.\nTests : uv run python -m pytest. Vérification sans appel modèle : uv run python ' +
      entry +
      ' --check. Pour modifier les dépendances : uv sync.\nLe débogage normal exécute l’agent et peut appeler le modèle facturé ; utilisez --check pour une vérification hors réseau.\n';
  }
  return parseTemplate({ ...template, files });
}

function withRustWorkspace(template: TemplateDefinition): TemplateDefinition {
  const files = { ...template.files };
  files['.vscode/settings.json'] = JSON.stringify(
    {
      'rust-analyzer.linkedProjects': ['./Cargo.toml'],
      'rust-analyzer.check.command': 'clippy',
    },
    null,
    2,
  );
  files['.vscode/extensions.json'] = JSON.stringify(
    { recommendations: ['rust-lang.rust-analyzer', 'vadimcn.vscode-lldb'] },
    null,
    2,
  );
  files['.vscode/tasks.json'] = JSON.stringify(
    {
      version: '2.0.0',
      tasks: [
        {
          label: 'Construire le projet',
          type: 'process',
          command: 'cargo',
          args: ['build', '--all-targets'],
          options: { cwd: '${workspaceFolder}' },
          problemMatcher: '$rustc',
          group: 'build',
        },
        {
          label: 'Tester le projet',
          type: 'process',
          command: 'cargo',
          args: ['test'],
          options: { cwd: '${workspaceFolder}' },
          problemMatcher: '$rustc',
          group: 'test',
        },
      ],
    },
    null,
    2,
  );
  files['.vscode/launch.json'] = JSON.stringify(
    {
      version: '0.2.0',
      configurations: [
        {
          name: 'Déboguer les tests Rust',
          type: 'lldb',
          request: 'launch',
          cargo: {
            args: ['test', '--no-run', '--test', 'project_layout'],
            filter: { name: 'project_layout', kind: 'test' },
          },
          cwd: '${workspaceFolder}',
        },
      ],
    },
    null,
    2,
  );
  files['tests/project_layout.rs'] =
    '#[test]\nfn crate_has_an_identity() {\n    assert!(!env!("CARGO_PKG_NAME").is_empty());\n}\n';
  files['README.md'] =
    (files['README.md'] ?? '') +
    '\n\n## VS Code et préparation Rust\nÀ la création, cargo build --all-targets télécharge et compile les dépendances automatiquement ; Rust/Cargo doivent être installés. Échec : relancez la commande dans ce dossier. Aucun agent lancé.\nLe dossier configure rust-analyzer, les tâches Construire/Tester le projet (cargo test) et le débogage CodeLLDB du test project_layout. Le test fourni vérifie seulement l’identité du crate, pas un comportement IA. Clippy et CodeLLDB doivent être disponibles pour leurs fonctionnalités.\nCette base contient une bibliothèque/backend, pas un agent IA exécutable. Aucun lancement IA ni intégration Scaleway Rust n’est certifié.\n';
  return parseTemplate({ ...template, files });
}
