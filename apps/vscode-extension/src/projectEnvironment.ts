import type { ListedModel } from './provider';
import { parseTemplate, type TemplateDefinition } from './templateLibrary';

const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function projectTarget(
  model: ListedModel,
  projectId: string,
): { endpoint: string; modelId: string } {
  if (!uuid(projectId)) throw new Error('invalid_project_scope');
  if (model.kind === 'serverless')
    return {
      endpoint: `https://api.scaleway.ai/${projectId}/v1`,
      modelId: model.id,
    };
  const info = model.deploymentInfo;
  if (
    model.kind !== 'dedicated' ||
    info?.projectId !== projectId ||
    !info.modelId
  )
    throw new Error('invalid_model_scope');
  const endpoints = (info.endpoints ?? []).filter(
    (e) => e.network === 'public' && e.authentication === 'iam',
  );
  if (endpoints.length !== 1) throw new Error('ambiguous_model_endpoint');
  const url = new URL(endpoints[0].url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('invalid_model_endpoint');
  return { endpoint: endpoints[0].url, modelId: info.modelId };
}
/** Public files only. Secret .env never enters TemplateDefinition. */
export function protectProjectEnvironment(
  value: TemplateDefinition,
): TemplateDefinition {
  const template = parseTemplate(value);
  if (
    Object.keys(template.files).some((p) =>
      p.split('/').some((part) => part.toLowerCase() === '.env'),
    )
  )
    throw new Error('template_env_conflict');
  return parseTemplate({
    ...template,
    files: {
      ...template.files,
      '.gitignore': `${template.files['.gitignore'] ?? ''}\n# Local credentials: never commit\n/.env\n`,
    },
  });
}
/** Values cannot break out of dotenv lines; quotes preserve # and whitespace. */
export function privateEnvContent(
  target: { endpoint: string; modelId: string },
  secretKey: string,
): string {
  if (!uuid(secretKey)) throw new Error('invalid_api_key');
  if (
    !target.modelId ||
    target.modelId.length > 256 ||
    [...(target.modelId + target.endpoint)].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    ) ||
    /['\\]/.test(target.modelId + target.endpoint)
  )
    throw new Error('invalid_environment_value');
  return `SCW_INFERENCE_BASE_URL='${target.endpoint}'\nSCW_INFERENCE_MODEL_ID='${target.modelId}'\nSCW_API_KEY='${secretKey}'\n`;
}
