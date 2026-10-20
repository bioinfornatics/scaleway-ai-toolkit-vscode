import { Buffer } from 'node:buffer';
import * as https from 'node:https';
import {
  type Project,
  ReadError,
  sessionHeaders,
  text,
  uuid,
  validateJWT,
} from './provider';

export interface ProjectCreationIntent {
  organizationId: string;
  name: string;
  confirmed: true;
}
export type CreateProjectTransport = (
  intent: ProjectCreationIntent,
  token: string,
  signal: AbortSignal,
) => Promise<unknown>;
/** Fixed operation, no generic POST/URL capability and no retries. */
export const postProject: CreateProjectTransport = (intent, token, signal) => {
  if (
    !uuid(intent.organizationId) ||
    !text(intent.name) ||
    intent.confirmed !== true ||
    !validateJWT(token)
  )
    return Promise.reject(new ReadError('invalid_creation_intent'));
  if (signal.aborted) return Promise.reject(new ReadError('cancelled'));
  const body = Buffer.from(
    JSON.stringify({
      organization_id: intent.organizationId,
      name: intent.name,
      description: '',
    }),
  );
  return new Promise((resolve, reject) => {
    let done = false,
      bytes = 0,
      dispatched = false;
    const chunks: Buffer[] = [];
    const finish = (error?: ReadError, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      request.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const uncertain = () =>
      new ReadError(
        dispatched ? 'creation_outcome_unknown' : 'transport_error',
      );
    const cancel = () =>
      finish(
        new ReadError(dispatched ? 'creation_outcome_unknown' : 'cancelled'),
      );
    const request = https.request(
      {
        hostname: 'api.scaleway.com',
        path: '/account/v3/projects',
        method: 'POST',
        agent: false,
        headers: {
          ...sessionHeaders(token),
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status !== 200 && status !== 201) {
          response.destroy();
          const code =
            status === 401 || status === 403
              ? 'access_denied'
              : status === 429
                ? 'rate_limited'
                : status >= 400 && status < 500
                  ? 'creation_rejected'
                  : 'creation_outcome_unknown';
          finish(new ReadError(code));
          return;
        }
        if (!response.headers['content-type']?.includes('application/json')) {
          response.destroy();
          finish(new ReadError('creation_outcome_unknown'));
          return;
        }
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            response.destroy();
            finish(new ReadError('creation_outcome_unknown'));
          } else chunks.push(chunk);
        });
        response.on('error', () => finish(uncertain()));
        response.on('aborted', () => finish(uncertain()));
        response.on('end', () => {
          try {
            finish(
              undefined,
              JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(
                  Buffer.concat(chunks),
                ),
              ),
            );
          } catch {
            finish(new ReadError('creation_outcome_unknown'));
          }
        });
      },
    );
    const timer = setTimeout(() => finish(uncertain()), 10000);
    request.on('error', () => finish(uncertain()));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    // Conservative: once end is invoked, any cancellation/transport failure can have reached the provider.
    dispatched = true;
    request.end(body);
  });
};
export async function createProject(
  intent: ProjectCreationIntent,
  token: string,
  signal: AbortSignal,
  post: CreateProjectTransport = postProject,
): Promise<Project> {
  if (
    !uuid(intent.organizationId) ||
    !text(intent.name) ||
    intent.confirmed !== true ||
    !validateJWT(token)
  )
    throw new ReadError('invalid_creation_intent');
  if (signal.aborted) throw new ReadError('cancelled');
  const value = await post(
    {
      organizationId: intent.organizationId,
      name: intent.name,
      confirmed: true,
    },
    token,
    signal,
  );
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ReadError('creation_outcome_unknown');
  const row = value as Record<string, unknown>;
  if (
    !uuid(row.id) ||
    row.organization_id !== intent.organizationId ||
    row.name !== intent.name
  )
    throw new ReadError('creation_outcome_unknown');
  return {
    id: row.id,
    name: intent.name,
    organizationId: intent.organizationId,
  };
}
