import { Buffer } from 'node:buffer';
import * as https from 'node:https';
import { createAdvancedClient, withHTTPClient } from '@scaleway/sdk-client';
import { Iamv1alpha1 } from '@scaleway/sdk-iam';

export type Bearer = { type: 'user' | 'application'; id: string };
export type AccessKeyMetadata = {
  accessKey: string;
  bearer: Bearer;
  expiresAt: number;
  organizationId: string;
  description: string;
};
export type IAMAccessErrorCode =
  | 'invalid_request'
  | 'invalid_api_key'
  | 'access_denied'
  | 'expired'
  | 'invalid_response'
  | 'transport_error'
  | 'timeout'
  | 'cancelled'
  | 'response_limit'
  | 'truncated_response'
  | 'redirect_rejected'
  | 'rate_limited'
  | 'http_error'
  | 'pagination_limit';

/** Only fixed local codes; never attach provider bodies, credentials or causes. */
export class IAMAccessError extends Error {
  constructor(public readonly code: IAMAccessErrorCode) {
    super(code);
    this.name = 'IAMAccessError';
  }
}
function fail(code: IAMAccessErrorCode): never {
  throw new IAMAccessError(code);
}
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const key = (v: unknown): v is string =>
  typeof v === 'string' && /^SCW[A-Z0-9]{17}$/.test(v);
const jwt = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 16384 &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
const text = (v: unknown, max: number, empty = false): v is string =>
  typeof v === 'string' &&
  (empty || v.trim().length > 0) &&
  v.length <= max &&
  !Array.from(v).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
const lifetimes = new Set([
  3600000,
  7 * 86400000,
  30 * 86400000,
  365 * 86400000,
]);
const origin = 'https://api.scaleway.com';
const base = '/iam/v1alpha1/';
const byteLimit = 2 * 1024 * 1024;
const timeoutMs = 10000;
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('invalid_response');
  return value as Row;
}
function checkSignal(signal: AbortSignal): void {
  if (!signal || typeof signal.addEventListener !== 'function')
    fail('invalid_request');
  if (signal.aborted) fail('cancelled');
}
function scope(orgId: string, credential: string, signal: AbortSignal): void {
  if (!uuid(orgId)) fail('invalid_request');
  if (!uuid(credential) && !jwt(credential)) fail('invalid_api_key');
  checkSignal(signal);
}
function bearerOf(data: Row): Bearer {
  // Empty/null inactive one-of fields are allowed; any nonempty invalid field is not.
  const user = data.user_id;
  const app = data.application_id;
  const absent = (v: unknown) => v === undefined || v === null || v === '';
  if (uuid(user) && absent(app)) return { type: 'user', id: user };
  if (uuid(app) && absent(user)) return { type: 'application', id: app };
  return fail('invalid_response');
}
function expiry(data: Row): number {
  // Missing expiry is not proof of an unlimited key. Only explicit null is.
  if (data.expires_at === null) return Number.MAX_SAFE_INTEGER;
  const v = data.expires_at;
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)
  )
    fail('invalid_response');
  const n = Date.parse(v);
  if (
    !Number.isFinite(n) ||
    new Date(n).toISOString().slice(0, 19) !== v.slice(0, 19)
  )
    fail('invalid_response');
  if (n <= Date.now()) fail('expired');
  return n;
}
function metadata(
  data: unknown,
  access: string,
  orgId: string,
): AccessKeyMetadata {
  const r = row(data);
  if (
    r.access_key !== access ||
    !key(r.access_key) ||
    !text(r.description, 200, true)
  )
    fail('invalid_response');
  // The official APIKey has no organizationId field. Membership is proven separately.
  // If a response supplies an extra organization field, it must not contradict scope.
  if ('organization_id' in r && r.organization_id !== orgId)
    fail('invalid_response');
  return {
    accessKey: access,
    bearer: bearerOf(r),
    expiresAt: expiry(r),
    organizationId: orgId,
    description: r.description,
  };
}
function pageData(
  data: unknown,
  field: string,
  max: number,
): { rows: unknown[]; total: number } {
  const r = row(data);
  if (
    !Array.isArray(r[field]) ||
    r[field].length > 100 ||
    !Number.isSafeInteger(r.total_count) ||
    (r.total_count as number) < 0
  )
    fail('invalid_response');
  if ((r.total_count as number) > max) fail('pagination_limit');
  return { rows: r[field] as unknown[], total: r.total_count as number };
}

type Expected = { method: 'GET' | 'POST'; path: string; body?: string };
function canonical(url: URL): string {
  url.searchParams.sort();
  return url.href;
}
/** Private, independent capability transport. A capability permits one exact SDK
 * request, never a caller URL. No redirects, proxy, retry, grants or application writes.
 */
async function boundedHTTP(
  request: Request,
  expected: Expected,
  credential: string,
  secretRead: boolean,
  signal: AbortSignal,
): Promise<unknown> {
  checkSignal(signal);
  const url = new URL(request.url);
  const target = new URL(expected.path, origin);
  const body = request.method === 'POST' ? await request.text() : undefined;
  const appList = url.pathname === `${base}applications`;
  const keyList =
    url.pathname === `${base}api-keys` && request.method === 'GET';
  const keyRead =
    url.pathname.startsWith(`${base}api-keys/`) &&
    key(url.pathname.slice(`${base}api-keys/`.length));
  const create =
    url.pathname === `${base}api-keys` && request.method === 'POST';
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hash ||
    canonical(url) !== canonical(target) ||
    request.method !== expected.method ||
    body !== expected.body ||
    !(appList || keyList || keyRead || create) ||
    (request.method !== 'GET' && !create) ||
    (!uuid(credential) && (!jwt(credential) || secretRead))
  )
    fail('invalid_request');
  const fields = appList
    ? ['organization_id', 'page', 'page_size']
    : keyList
      ? ['access_keys', 'organization_id', 'page', 'page_size']
      : [];
  if (
    url.searchParams.size !== fields.length ||
    fields.some((f) => url.searchParams.getAll(f).length !== 1)
  )
    fail('invalid_request');
  if (
    fields.length &&
    (!uuid(url.searchParams.get('organization_id')) ||
      !/^[1-5]$/.test(url.searchParams.get('page') ?? '') ||
      url.searchParams.get('page_size') !== '100' ||
      (keyList && !key(url.searchParams.get('access_keys'))))
  )
    fail('invalid_request');
  if (body !== undefined) {
    if (Buffer.byteLength(body) > 4096) fail('invalid_request');
    let r: Row;
    try {
      r = JSON.parse(body);
    } catch {
      return fail('invalid_request');
    }
    if (
      !r ||
      typeof r !== 'object' ||
      Array.isArray(r) ||
      !text(r.description, 200, true) ||
      Object.keys(r).sort().join(',') !==
        (uuid(r.user_id)
          ? 'description,expires_at,user_id'
          : 'application_id,description,expires_at') ||
      !(uuid(r.user_id) || uuid(r.application_id)) ||
      typeof r.expires_at !== 'string'
    )
      fail('invalid_request');
    const until = Date.parse(r.expires_at);
    const remaining = until - Date.now();
    if (
      !Number.isFinite(until) ||
      new Date(until).toISOString() !== r.expires_at ||
      ![...lifetimes].some(
        (ms) => remaining > ms - timeoutMs && remaining <= ms,
      )
    )
      fail('invalid_request');
  }
  checkSignal(signal);
  return new Promise<unknown>((resolve, reject) => {
    let done = false;
    let bytes = 0;
    let req: ReturnType<typeof https.request> | undefined;
    let res: import('node:http').IncomingMessage | undefined;
    const chunks: Buffer[] = [];
    const finish = (code?: IAMAccessErrorCode, result?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      // Best-effort wipe of owned buffers; JS strings cannot be securely erased.
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      res?.destroy();
      req?.destroy();
      if (code) reject(new IAMAccessError(code));
      else resolve(result);
    };
    const cancel = () => finish('cancelled');
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      req = https.request(
        {
          hostname: 'api.scaleway.com',
          port: 443,
          protocol: 'https:',
          method: expected.method,
          path: url.pathname + url.search,
          agent: false,
          rejectUnauthorized: true,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(uuid(credential)
              ? { 'X-Auth-Token': credential }
              : { 'X-Session-Token': credential }),
          },
        },
        (incoming) => {
          res = incoming;
          if (done) {
            incoming.destroy();
            return;
          }
          const status = incoming.statusCode ?? 0;
          if (status !== 200 && !(create && status === 201)) {
            finish(
              status === 401
                ? secretRead
                  ? 'invalid_api_key'
                  : 'access_denied'
                : status === 403
                  ? 'access_denied'
                  : status === 429
                    ? 'rate_limited'
                    : status >= 300 && status < 400
                      ? 'redirect_rejected'
                      : 'http_error',
            );
            return;
          }
          const contentType = incoming.headers['content-type'];
          const length = incoming.headers['content-length'];
          if (
            typeof contentType !== 'string' ||
            !/^application\/json(?:\s*;|$)/i.test(contentType) ||
            (incoming.headers['content-encoding'] &&
              incoming.headers['content-encoding'] !== 'identity') ||
            (length !== undefined &&
              (typeof length !== 'string' || !/^\d+$/.test(length)))
          ) {
            finish('invalid_response');
            return;
          }
          const declared = length === undefined ? undefined : Number(length);
          if (
            declared !== undefined &&
            (!Number.isSafeInteger(declared) || declared > byteLimit)
          ) {
            finish('response_limit');
            return;
          }
          incoming.on('data', (chunk: Buffer) => {
            if (done) return;
            bytes += chunk.length;
            if (bytes > byteLimit) finish('response_limit');
            else chunks.push(Buffer.from(chunk));
          });
          incoming.on('aborted', () => finish('truncated_response'));
          incoming.on('error', () => finish('transport_error'));
          incoming.on('close', () => {
            if (!done) finish('truncated_response');
          });
          incoming.on('end', () => {
            if (done) return;
            if (
              incoming.complete === false ||
              (declared !== undefined && bytes !== declared)
            ) {
              finish('truncated_response');
              return;
            }
            const all = Buffer.concat(chunks);
            try {
              const wire = new TextDecoder('utf-8', { fatal: true }).decode(
                all,
              );
              const parsed: unknown = JSON.parse(wire);
              finish(undefined, parsed);
            } catch {
              finish('invalid_response');
            } finally {
              all.fill(0);
            }
          });
        },
      );
      req.on('error', () => finish('transport_error'));
      if (signal.aborted) cancel();
      if (!done) req.end(body);
    } catch {
      finish('transport_error');
    }
  });
}

/** Invoke exactly one installed SDK method. Raw JSON, not generated defaults,
 * is authoritative. Secrets are removed before the SDK sees a response.
 */
async function sdkRaw(
  expected: Expected,
  credential: string,
  secretRead: boolean,
  signal: AbortSignal,
  invoke: (api: Iamv1alpha1.API) => Promise<unknown>,
): Promise<unknown> {
  let raw: unknown;
  let received = false;
  let used = false;
  let transportFailure: IAMAccessError | undefined;
  const http: typeof fetch = async (input, init) => {
    try {
      if (used) fail('invalid_request');
      used = true;
      const request =
        input instanceof Request ? input : new Request(input, init);
      raw = await boundedHTTP(
        request,
        expected,
        credential,
        secretRead,
        signal,
      );
      received = true;
      // Do not copy response secrets into SDK-normalized objects.
      const clean = JSON.stringify(raw, (name, value) =>
        name === 'secret_key' ? undefined : value,
      );
      return new Response(clean, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      transportFailure =
        error instanceof IAMAccessError
          ? error
          : new IAMAccessError('transport_error');
      throw transportFailure;
    }
  };
  try {
    try {
      await invoke(
        new Iamv1alpha1.API(createAdvancedClient(withHTTPClient(http))),
      );
    } catch {
      if (!received)
        throw transportFailure ?? new IAMAccessError('invalid_response');
    }
    if (transportFailure) throw transportFailure;
    checkSignal(signal);
    if (!received) fail('invalid_response');
    return raw;
  } finally {
    // Failure paths must not retain a raw response secret through a closure.
    if (transportFailure || signal.aborted) scrub(raw);
  }
}
function scrub(value: unknown): void {
  // Iterative to avoid stack overflow on deeply nested untrusted JSON.
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    const r = item as Row;
    delete r.secret_key;
    for (const nested of Object.values(r)) {
      if (nested && typeof nested === 'object') pending.push(nested);
    }
  }
}
function listPath(
  route: string,
  orgId: string,
  page: number,
  access?: string,
): string {
  const params = new URLSearchParams({
    organization_id: orgId,
    page: String(page),
    page_size: '100',
  });
  if (access) params.set('access_keys', access);
  return `${base + route}?${params}`;
}

export async function listAccessApplications(
  orgId: string,
  credential: string,
  signal: AbortSignal,
): Promise<{ id: string; name: string }[]> {
  scope(orgId, credential, signal);
  const result: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let page = 1; page <= 5; page++) {
    const raw = await sdkRaw(
      { method: 'GET', path: listPath('applications', orgId, page) },
      credential,
      false,
      signal,
      (api) =>
        api.listApplications(
          { organizationId: orgId, page, pageSize: 100 },
          { signal },
        ),
    );
    try {
      const p = pageData(raw, 'applications', 500);
      if (total !== undefined && total !== p.total) fail('invalid_response');
      total = p.total;
      if (p.rows.length !== Math.min(100, total - result.length))
        fail('invalid_response');
      for (const value of p.rows) {
        const r = row(value);
        if (
          !uuid(r.id) ||
          r.organization_id !== orgId ||
          !text(r.name, 64) ||
          seen.has(r.id)
        )
          fail('invalid_response');
        seen.add(r.id);
        result.push({ id: r.id, name: r.name });
      }
      if (result.length === total) return result;
    } finally {
      scrub(raw);
    }
  }
  return fail('pagination_limit');
}

/** Caller MUST confirm organization/bearer authorization and consent before this
 * write, and inspect metadata afterwards. This method does not prove org ownership,
 * grant permissions, create an application, bind a model, retry, or manage pending state.
 */
export async function createAccessAPIKey(
  orgId: string,
  bearer: Bearer,
  credential: string,
  description: string,
  lifetimeMs: number,
  signal: AbortSignal,
): Promise<{ accessKey: string; secretKey: string; expiresAt: number }> {
  scope(orgId, credential, signal);
  if (
    !bearer ||
    !['user', 'application'].includes(bearer.type) ||
    !uuid(bearer.id) ||
    Object.keys(bearer).sort().join(',') !== 'id,type' ||
    !text(description, 200, true) ||
    !lifetimes.has(lifetimeMs)
  )
    fail('invalid_request');
  const expiresAt = Date.now() + lifetimeMs;
  const fields = {
    description,
    expires_at: new Date(expiresAt).toISOString(),
    ...(bearer.type === 'user'
      ? { user_id: bearer.id }
      : { application_id: bearer.id }),
  };
  const raw = await sdkRaw(
    { method: 'POST', path: `${base}api-keys`, body: JSON.stringify(fields) },
    credential,
    false,
    signal,
    (api) =>
      api.createAPIKey(
        {
          description,
          expiresAt: new Date(expiresAt),
          ...(bearer.type === 'user'
            ? { userId: bearer.id }
            : { applicationId: bearer.id }),
        },
        { signal },
      ),
  );
  try {
    const r = row(raw);
    if (!key(r.access_key) || !uuid(r.secret_key)) fail('invalid_response');
    const m = metadata(r, r.access_key, orgId);
    if (
      m.bearer.type !== bearer.type ||
      m.bearer.id !== bearer.id ||
      m.description !== description ||
      m.expiresAt !== expiresAt
    )
      fail('invalid_response');
    return {
      accessKey: r.access_key,
      secretKey: r.secret_key,
      expiresAt: m.expiresAt,
    };
  } finally {
    scrub(raw);
  }
}

/** Authenticate the exact key with its secret, then prove organization membership
 * using the official filtered listAPIKeys wire request. Never return a response secret.
 */
export async function inspectAccessAPIKey(
  orgId: string,
  accessKey: string,
  secretKey: string,
  signal: AbortSignal,
): Promise<AccessKeyMetadata> {
  if (!key(accessKey) || !uuid(secretKey)) fail('invalid_api_key');
  scope(orgId, secretKey, signal);
  const raw = await sdkRaw(
    { method: 'GET', path: `${base}api-keys/${accessKey}` },
    secretKey,
    true,
    signal,
    (api) => api.getAPIKey({ accessKey }, { signal }),
  );
  let m: AccessKeyMetadata;
  try {
    m = metadata(raw, accessKey, orgId);
  } finally {
    scrub(raw);
  }
  const listed = await sdkRaw(
    { method: 'GET', path: listPath('api-keys', orgId, 1, accessKey) },
    secretKey,
    true,
    signal,
    (api) =>
      api.listAPIKeys(
        {
          organizationId: orgId,
          accessKeys: [accessKey],
          page: 1,
          pageSize: 100,
        },
        { signal },
      ),
  );
  try {
    const p = pageData(listed, 'api_keys', 500);
    if (p.total === 0 && p.rows.length === 0) fail('access_denied');
    if (p.total !== 1 || p.rows.length !== 1) fail('invalid_response');
    const confirmed = metadata(p.rows[0], accessKey, orgId);
    if (
      confirmed.bearer.type !== m.bearer.type ||
      confirmed.bearer.id !== m.bearer.id ||
      confirmed.expiresAt !== m.expiresAt ||
      confirmed.description !== m.description
    )
      fail('invalid_response');
    return m;
  } finally {
    scrub(listed);
  }
}
