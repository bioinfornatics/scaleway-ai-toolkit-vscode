import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  type GetJSON,
  getJSON,
  type ListedModel,
  type Project,
  ReadError,
  uuid,
} from './provider';
export interface ModelEula {
  modelId: string;
  projectId: string;
  organizationId: string;
  region: 'fr-par';
  content: string;
  sha256: string;
  fetchedAt: string;
  accepted: false;
}
/** Text is untrusted provider data: never rendered as HTML/Markdown, executed or auto-accepted. */
export async function getModelEula(
  project: Project,
  model: ListedModel,
  token: string,
  signal: AbortSignal,
  get: GetJSON = getJSON,
  now = new Date(),
): Promise<ModelEula> {
  if (
    !uuid(project.id) ||
    !uuid(project.organizationId) ||
    !uuid(model.id) ||
    model.kind !== 'dedicated-catalog' ||
    model.dedicatedInfo?.hasEula !== true
  )
    throw new ReadError('invalid_scope');
  const value = await get(
    'control',
    ['/inference/v1/regions/fr-par/models/', model.id, '/eula'].join(''),
    token,
    signal,
  );
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ReadError('invalid_eula_response');
  const content = (value as Record<string, unknown>).content;
  if (
    typeof content !== 'string' ||
    !content.trim() ||
    Buffer.byteLength(content, 'utf8') > 262144 ||
    Array.from(content).some((character) => {
      const code = character.charCodeAt(0);
      return (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
      );
    })
  )
    throw new ReadError('invalid_eula_response');
  return {
    modelId: model.id,
    projectId: project.id,
    organizationId: project.organizationId,
    region: 'fr-par',
    content,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    fetchedAt: now.toISOString(),
    accepted: false,
  };
}
