import { withEmbeddedAgentLaunch } from './projectGenerator';
import type { ListedModel } from './provider';
import type { StackChoice } from './stackScaffold';
import { parseTemplate, type TemplateDefinition } from './templateLibrary';

export interface AgentModelContext {
  key: string;
  projectId?: string;
  status: string;
  rows: ListedModel[];
  apiKeys?: import('./llmAccessRegistry').ApiKeyResource[];
}
export interface AgentModelSource {
  current(): AgentModelContext;
  refresh(): Promise<void>;
  addKey?(): Promise<void>;
  credentialScope?(
    projectId: string,
    model: ListedModel,
    preferredKeyId?: string,
  ):
    | {
        current(): boolean;
        secretKey(): string;
        dispose(): void;
      }
    | Promise<{ current(): boolean; secretKey(): string; dispose(): void }>;
}
/** Public Serverless model choices and real dedicated deployments.
 * Selection never grants execution authority: credentials are chosen/revalidated separately. */
export function deployedAgentModels(context: AgentModelContext): ListedModel[] {
  if (!context.projectId || !context.key) return [];
  return context.rows
    .filter((r) => {
      if (r.kind === 'serverless')
        return (
          !!r.id &&
          !!r.label &&
          !/deleted|retired|end.of.life/i.test(r.status ?? '') &&
          (!r.llmAccess ||
            (r.llmAccess.projectId === context.projectId &&
              r.llmAccess.expiresAt > Date.now() + 30000 &&
              r.serverlessAvailability === 'Disponible'))
        );
      return (
        !/Erreur|Chargement|Non charg/i.test(context.status) &&
        r.kind === 'dedicated' &&
        r.deploymentInfo?.projectId === context.projectId &&
        r.deploymentInfo?.region === 'fr-par' &&
        !!r.deploymentInfo?.modelId &&
        !/deleted|deleting|error|failed/i.test(r.status ?? '')
      );
    })
    .slice(0, 256);
}
/** UI identity is the model, not deployment label or endpoint URL. */
export function agentModelLabel(model: ListedModel): string {
  const identity =
    model.kind === 'serverless'
      ? model.id
      : (model.deploymentInfo?.modelName ??
        model.deploymentInfo?.modelId ??
        model.id);
  // URLs must never become model names, even if a service uses one as its label.
  const safe = /^https?:\/\//i.test(identity)
    ? (model.deploymentInfo?.modelId ?? 'Modèle non identifié')
    : identity;
  return (
    safe +
    ' · ' +
    (model.kind === 'serverless' ? 'Serverless' : 'Dédié') +
    (model.kind === 'dedicated' && model.status ? ' · ' + model.status : '')
  );
}
/** Compose two inspectable bases; collisions must be explicitly reconciled. */
export function composeAgentProject(
  backend: StackChoice | undefined,
  ai: StackChoice | undefined,
  name: string,
  model?: ListedModel,
  personal?: TemplateDefinition,
  projectId?: string,
): TemplateDefinition {
  if (backend && backend.category !== 'backend' && backend.category !== 'basic')
    throw new Error('invalid_backend');
  if (ai && ai.category !== 'agent') throw new Error('invalid_ai');
  if (backend && ai && backend.language !== ai.language)
    throw new Error('incompatible_language');
  const base = personal ?? backend?.template ?? ai?.template;
  if (base?.kind !== 'agents') throw new Error('missing_base');
  const files = { ...parseTemplate(base).files };
  if (!personal && backend && ai) {
    const sdkFiles = parseTemplate(ai.template).files;
    for (const [p, content] of Object.entries(sdkFiles)) {
      if (p === 'agent.authoring.json') continue;
      if (p === 'README.md') {
        files[p] += `\n\n## Base framework IA\n${content}`;
        continue;
      }
      if (p === 'requirements.txt') {
        files[p] = [...new Set(`${files[p]}\n${content}`.split('\n'))].join(
          '\n',
        );
        continue;
      }
      if (p === 'package.json') {
        const a = JSON.parse(files[p]),
          b = JSON.parse(content);
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (['name', 'dependencies', 'devDependencies'].includes(key))
            continue;
          if (JSON.stringify(a[key]) !== JSON.stringify(b[key]))
            throw new Error('package_conflict');
        }
        for (const section of ['dependencies', 'devDependencies']) {
          for (const [key, value] of Object.entries(b[section] ?? {})) {
            if (a[section]?.[key] && a[section][key] !== value)
              throw new Error('dependency_conflict');
          }
          a[section] = { ...a[section], ...b[section] };
        }
        files[p] = JSON.stringify(a, null, 2);
        continue;
      }
      const target =
        p === 'agent.py'
          ? 'agent_sdk.py'
          : p === 'src/agent.ts'
            ? 'src/agent-sdk.ts'
            : p;
      if (files[target] !== undefined && files[target] !== content)
        throw new Error('asset_conflict');
      files[target] = content;
    }
  }
  // Personal payloads are preserved. User choices live in a separate authoring note.
  const note = personal ? 'agent.creation.json' : 'agent.authoring.json';
  if (personal && files[note] !== undefined)
    throw new Error('authoring_conflict');
  files[note] = JSON.stringify(
    {
      authoring_version: 1,
      kind: 'agents',
      name,
      incomplete: true,
      ...(personal
        ? { template_id: personal.id }
        : {
            language: backend?.language ?? ai?.language,
            backend: backend?.framework ?? 'none',
            ai_framework: ai?.framework ?? 'none',
          }),
      ...(model?.kind === 'serverless'
        ? {
            selected_model: {
              kind: 'serverless',
              model_id: model.id,
              project_id: projectId,
              availability: model.serverlessAvailability ?? 'Non vérifiée',
            },
          }
        : model
          ? {
              selected_deployment: {
                kind: 'dedicated',
                deployment_id: model.id,
                model_id: model.deploymentInfo?.modelId,
                project_id: model.deploymentInfo?.projectId,
                region: 'fr-par',
              },
            }
          : {}),
      note: 'Authoring selection only. Configure trusted Scaleway model mapping, runtime and backend/SDK integration before execution.',
    },
    null,
    2,
  );
  if (files['package.json'] && !personal) {
    const pkg = JSON.parse(files['package.json']);
    pkg.name = name.toLowerCase();
    files['package.json'] = JSON.stringify(pkg, null, 2);
  }
  const result = parseTemplate({ ...base, label: name, files });
  return personal ? result : withEmbeddedAgentLaunch(result);
}
