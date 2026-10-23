import * as TOML from '@iarna/toml';
import Mustache from 'mustache';
import {
  type ProjectTemplate,
  parseTemplate,
  type TemplateDefinition,
} from './templateLibrary';

type Language = ProjectTemplate['language'];
const managers = { python: 'uv', typescript: 'bun', rust: 'cargo' } as const;
export interface ProjectValues {
  name: string;
  modelId?: string;
}
function variables(values: ProjectValues): Record<string, string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(values.name))
    throw new Error('invalid_project_name');
  if (
    values.modelId !== undefined &&
    (values.modelId.length > 256 ||
      [...values.modelId].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      ))
  )
    throw new Error('invalid_model_id');
  return {
    project_name: values.name,
    package_name: values.name.toLowerCase().replaceAll('_', '-'),
    module_name: `app_${values.name.toLowerCase().replaceAll('-', '_')}`,
    model_id: values.modelId ?? '',
  };
}
/** Real Mustache, restricted to scalar names: no lambdas, sections, partials,
 * delimiter changes or path rendering. Undefined values fail, not empty success. */
function interpolate(
  text: string,
  context: Record<string, string>,
  structured: boolean,
): string {
  const tokens = Mustache.parse(text);
  for (const token of tokens) {
    if (token[0] === 'text') continue;
    if (
      token[0] !== 'name' ||
      !Object.hasOwn(context, token[1]) ||
      (!structured && token[1] === 'model_id')
    )
      throw new Error('unsupported_template_expression');
  }
  // Name variables are restricted identifiers. For JSON/TOML strings, the format
  // serializer does escaping after rendering; HTML escaping would corrupt data.
  return Mustache.render(text, context, undefined, {
    escape: (value: string) => value,
  });
}
function structured(
  value: unknown,
  context: Record<string, string>,
  depth = 0,
): unknown {
  if (depth > 32) throw new Error('template_depth');
  if (typeof value === 'string') return interpolate(value, context, true);
  if (Array.isArray(value))
    return value.map((v) => structured(v, context, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, v] of Object.entries(value)) {
      if (
        key.includes('{{') ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      )
        throw new Error('unsupported_template_key');
      out[key] = structured(v, context, depth + 1);
    }
    return out;
  }
  return value;
}
/** Legacy v1 is copied byte-for-byte. v2 renders only explicitly declared files. */
export function renderProjectTemplate(
  value: TemplateDefinition,
  values: ProjectValues,
): TemplateDefinition {
  const template = parseTemplate(value);
  if (template.version === 1) return template;
  const context = variables(values);
  const files = { ...template.files };
  for (const [p, mode] of Object.entries(template.project?.render ?? {})) {
    if (mode === 'text') files[p] = interpolate(files[p], context, false);
    else if (mode === 'json')
      files[p] =
        `${JSON.stringify(structured(JSON.parse(files[p]), context), null, 2)}\n`;
    else
      files[p] = TOML.stringify(
        structured(TOML.parse(files[p]), context) as Parameters<
          typeof TOML.stringify
        >[0],
      );
  }
  // No Mustache re-evaluation: values containing delimiters remain ordinary data.
  return parseTemplate({ ...template, files });
}
/** Adapt only host-owned embedded bases. Personal templates must opt into v2. */
export function prepareEmbeddedProject(
  value: TemplateDefinition,
  language: Language,
): TemplateDefinition {
  const template = parseTemplate(value);
  const files = { ...template.files };
  const render: ProjectTemplate['render'] = {};
  if (language === 'python') {
    const deps = (files['requirements.txt'] ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
    if (
      deps.some(
        (s) =>
          !/^([A-Za-z0-9][A-Za-z0-9_.-]*)(\[[A-Za-z0-9_,.-]+\])?([<>=!~][A-Za-z0-9.*<>=!~,+-]+)?$/.test(
            s,
          ),
      )
    )
      throw new Error('unsupported_requirement');
    if (files['pyproject.toml']) throw new Error('manifest_conflict');
    const agent = template.kind === 'agents';
    files['pyproject.toml'] = TOML.stringify({
      ...(agent
        ? {
            'build-system': {
              requires: ['hatchling>=1.27,<2'],
              'build-backend': 'hatchling.build',
            },
            'dependency-groups': {
              dev: ['pytest>=8,<10'],
              eval: ['deepeval>=3,<4'],
            },
          }
        : {}),
      project: {
        name: '{{package_name}}',
        version: '0.1.0',
        description: 'Local AI authoring project',
        'requires-python': '>=3.11',
        dependencies: deps,
      },
      tool: {
        uv: { package: agent },
        ...(agent
          ? {
              hatch: {
                build: { targets: { wheel: { packages: ['src/agent_app'] } } },
              },
              pytest: {
                ini_options: {
                  testpaths: ['tests'],
                  markers: [
                    'integration: opt-in evaluations requiring reviewed runtime integration',
                  ],
                },
              },
            }
          : {}),
      },
    });
    render['pyproject.toml'] = 'toml';
  } else if (language === 'typescript') {
    const pkg = files['package.json']
      ? JSON.parse(files['package.json'])
      : {
          private: true,
          type: 'module',
          scripts: { build: 'tsc -p .' },
          devDependencies: { typescript: '^5.9.0', '@types/node': '^22.0.0' },
        };
    pkg.name = '{{package_name}}';
    pkg.engines = { ...pkg.engines, bun: '>=1.3.0' };
    files['package.json'] = JSON.stringify(pkg, null, 2);
    render['package.json'] = 'json';
  } else {
    const cargo = files['Cargo.toml']
      ? TOML.parse(files['Cargo.toml'])
      : { package: { version: '0.1.0', edition: '2021' } };
    const pkg = cargo.package as Record<string, unknown>;
    pkg.name = '{{package_name}}';
    files['Cargo.toml'] = TOML.stringify(
      cargo as Parameters<typeof TOML.stringify>[0],
    );
    render['Cargo.toml'] = 'toml';
  }
  return parseTemplate({
    ...template,
    version: 2,
    project: {
      language,
      package_manager: managers[language],
      engine: 'mustache',
      render,
    },
    files,
  });
}
export function installCommand(
  value: TemplateDefinition,
): { executable: string; args: string[] } | undefined {
  const template = parseTemplate(value);
  if (template.version !== 2) return;
  const config = template.project;
  if (!config) return;
  const manifest =
    config.language === 'python'
      ? 'pyproject.toml'
      : config.language === 'rust'
        ? 'Cargo.toml'
        : 'package.json';
  if (!Object.hasOwn(template.files, manifest)) return;
  if (manifest === 'package.json') JSON.parse(template.files[manifest]);
  else TOML.parse(template.files[manifest]);
  return {
    executable: config.package_manager,
    args:
      config.package_manager === 'cargo'
        ? ['fetch']
        : config.package_manager === 'uv'
          ? ['sync']
          : ['install'],
  };
}

/** Only host-owned bases acquire defaults. Personal templates carry their own
 * config payload unchanged; no guessing from their language or filenames. */
export function withEmbeddedAgentLaunch(
  value: TemplateDefinition,
): TemplateDefinition {
  if (
    value.kind !== 'agents' ||
    value.files['.vscode/scaleway-agent-run.json'] !== undefined
  )
    return value;
  const entry = ['src/agent_app/agent.py', 'agent.py', 'src/agent.ts'].find(
    (p) => Object.hasOwn(value.files, p),
  );
  if (!entry) return value;
  const files = {
    ...value.files,
    '.vscode/scaleway-agent-run.json': JSON.stringify(
      {
        version: 1,
        ready: false,
        runtime: entry.endsWith('.py') ? 'python' : 'node',
        entry: entry.endsWith('.ts') ? 'dist/agent.js' : entry,
        args: [],
      },
      null,
      2,
    ),
  };
  return parseTemplate({ ...value, files });
}
