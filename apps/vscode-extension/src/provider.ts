import { Buffer } from 'node:buffer';
/** Fixed-origin read-only provider adapter. No inference, retries or redirects. */
import * as https from 'node:https';
export class ReadError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export interface Organization {
  id: string;
  name: string;
  locked: boolean;
}
export interface Project {
  id: string;
  name: string;
  organizationId: string;
}
export interface SupportedNode {
  nodeTypeName: string;
  quantizationBits: number;
  allowed: boolean;
  maxContextSize: number;
}
export interface DedicatedModelInfo {
  status: string;
  hasEula: boolean | undefined;
  supportedNodes: SupportedNode[];
}
export interface NodeType {
  name: string;
  stockStatus: string;
  disabled: boolean;
  region: 'fr-par';
}
export interface ListedModel {
  id: string;
  label: string;
  kind: 'serverless' | 'dedicated' | 'dedicated-catalog';
  status?: string;
  dedicatedInfo?: DedicatedModelInfo;
}
export const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const text = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 256 &&
  !Array.from(v).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
export function validateJWT(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= 16384 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)
  );
}
export function sessionHeaders(token: string): Record<string, string> {
  if (!validateJWT(token)) throw new ReadError('invalid_request');
  return { 'X-Session-Token': token, Accept: 'application/json' };
}
export type GetJSON = (
  origin: 'control' | 'models',
  path: string,
  key: string,
  signal: AbortSignal,
) => Promise<unknown>;
export const getJSON: GetJSON = (origin, path, key, signal) => {
  if (signal.aborted) return Promise.reject(new ReadError('cancelled'));
  // Do not send user JWT to api.scaleway.ai without established audience support.
  let allowed = false;
  let publicRoute = false;
  if (origin === 'control') {
    const url = new URL(path, 'https://api.scaleway.com');
    const connectionRoute =
      /^\/iam\/v1alpha1\/users\/[0-9a-f-]{36}\/connections$/i.test(
        url.pathname,
      ) && uuid(url.pathname.split('/')[4]);
    const projectRoute = url.pathname === '/account/v3/projects';
    const modelRoute = url.pathname === '/inference/v1/regions/fr-par/models';
    const nodeRoute =
      url.pathname === '/inference/v1/regions/fr-par/node-types';
    const deploymentRoute =
      url.pathname === '/inference/v1/regions/fr-par/deployments';
    const fields = projectRoute
      ? ['organization_id', 'page', 'page_size']
      : ['organization_id', 'project_id', 'page', 'page_size'];
    allowed =
      url.origin === 'https://api.scaleway.com' &&
      !url.hash &&
      !url.username &&
      !url.password &&
      (projectRoute || deploymentRoute || modelRoute) &&
      [...url.searchParams.keys()].length === fields.length &&
      fields.every((f) => url.searchParams.getAll(f).length === 1) &&
      uuid(url.searchParams.get('organization_id')) &&
      (projectRoute || uuid(url.searchParams.get('project_id'))) &&
      /^[1-5]$/.test(url.searchParams.get('page') ?? '') &&
      url.searchParams.get('page_size') === '100';
    if (nodeRoute)
      allowed =
        url.origin === 'https://api.scaleway.com' &&
        !url.hash &&
        !url.username &&
        !url.password &&
        url.searchParams.size === 3 &&
        ['include_disabled_types', 'page', 'page_size'].every(
          (field) => url.searchParams.getAll(field).length === 1,
        ) &&
        url.searchParams.get('include_disabled_types') === 'true' &&
        /^[1-5]$/.test(url.searchParams.get('page') ?? '') &&
        url.searchParams.get('page_size') === '100';
    publicRoute =
      url.pathname === '/product-catalog/v2alpha1/public-catalog/products';
    if (publicRoute)
      allowed =
        url.origin === 'https://api.scaleway.com' &&
        !url.hash &&
        !url.username &&
        !url.password &&
        url.searchParams.size === 4 &&
        ['product_types', 'region', 'page', 'page_size'].every(
          (k) => url.searchParams.getAll(k).length === 1,
        ) &&
        url.searchParams.get('product_types') === 'generative_apis' &&
        url.searchParams.get('region') === 'fr-par' &&
        /^[1-5]$/.test(url.searchParams.get('page') ?? '') &&
        url.searchParams.get('page_size') === '100';
    if (connectionRoute)
      allowed =
        url.origin === 'https://api.scaleway.com' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password;
  }
  if ((!publicRoute && !validateJWT(key)) || !allowed)
    return Promise.reject(new ReadError('invalid_request'));
  return new Promise((resolve, reject) => {
    let done = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const end = (error?: ReadError, data?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      req.destroy();
      error ? reject(error) : resolve(data);
    };
    const cancel = () => end(new ReadError('cancelled'));
    const req = https.request(
      {
        hostname: origin === 'control' ? 'api.scaleway.com' : 'api.scaleway.ai',
        path,
        method: 'GET',
        agent: false,
        headers: publicRoute
          ? { Accept: 'application/json' }
          : sessionHeaders(key),
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.destroy();
          return end(
            new ReadError(
              res.statusCode === 401 || res.statusCode === 403
                ? 'access_denied'
                : res.statusCode === 429
                  ? 'rate_limited'
                  : res.statusCode &&
                      res.statusCode >= 300 &&
                      res.statusCode < 400
                    ? 'redirect_rejected'
                    : 'http_error',
            ),
          );
        }
        if (!res.headers['content-type']?.includes('application/json')) {
          res.destroy();
          return end(new ReadError('invalid_response'));
        }
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            res.destroy();
            end(new ReadError('response_limit'));
          } else chunks.push(chunk);
        });
        res.on('error', () => end(new ReadError('transport_error')));
        res.on('aborted', () => end(new ReadError('truncated_response')));
        res.on('end', () => {
          try {
            end(
              undefined,
              JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(
                  Buffer.concat(chunks),
                ),
              ),
            );
          } catch {
            end(new ReadError('invalid_response'));
          }
        });
      },
    );
    const timer = setTimeout(() => end(new ReadError('timeout')), 10000);
    req.on('error', () => end(new ReadError('transport_error')));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) return cancel();
    req.end();
  });
};
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new ReadError('invalid_response');
  return v as Record<string, unknown>;
}
/** At most 5 sequential pages per collection. Partial/malformed results are errors. */
async function pages(
  field: string,
  origin: 'control',
  path: string,
  key: string,
  signal: AbortSignal,
  get: GetJSON,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; page <= 5; page++) {
    if (signal.aborted) throw new ReadError('cancelled');
    const body = record(
      await get(origin, `${path}&page=${page}&page_size=100`, key, signal),
    );
    const items = body[field];
    if (!Array.isArray(items) || items.length > 100)
      throw new ReadError('invalid_response');
    rows.push(...items);
    const total = body.total_count;
    if (
      total !== undefined &&
      (!Number.isSafeInteger(total) || Number(total) < rows.length)
    )
      throw new ReadError('invalid_response');
    if (total === rows.length || items.length < 100) {
      if (total !== undefined && total !== rows.length)
        throw new ReadError('incomplete_page');
      return rows;
    }
  }
  throw new ReadError('page_limit');
}
/** One SDK-backed IAM GET; no users/emails retained and no membership mutation. */
export async function listOrganizations(
  userId: string,
  token: string,
  signal: AbortSignal,
  get: GetJSON = getJSON,
): Promise<Organization[]> {
  if (!uuid(userId)) throw new ReadError('invalid_scope');
  if (signal.aborted) throw new ReadError('cancelled');
  const body = record(
    await get(
      'control',
      `/iam/v1alpha1/users/${userId}/connections`,
      token,
      signal,
    ),
  );
  if (!Array.isArray(body.connections) || body.connections.length > 500)
    throw new ReadError('invalid_response');
  const result = body.connections.map((value) => {
    const row = record(value);
    const org = record(row.organization);
    if (!uuid(org.id) || !text(org.name) || typeof org.locked !== 'boolean')
      throw new ReadError('invalid_response');
    return { id: org.id, name: org.name, locked: org.locked };
  });
  if (new Set(result.map((o) => o.id)).size !== result.length)
    throw new ReadError('duplicate_id');
  return result;
}
export async function listProjects(
  org: string,
  key: string,
  signal: AbortSignal,
  get: GetJSON = getJSON,
): Promise<Project[]> {
  if (!uuid(org)) throw new ReadError('invalid_scope');
  const rows = await pages(
    'projects',
    'control',
    `/account/v3/projects?organization_id=${encodeURIComponent(org)}`,
    key,
    signal,
    get,
  );
  const result = rows.map((value) => {
    const row = record(value);
    if (!uuid(row.id) || !text(row.name) || row.organization_id !== org)
      throw new ReadError('foreign_or_invalid_scope');
    return { id: row.id, name: row.name, organizationId: org };
  });
  if (new Set(result.map((p) => p.id)).size !== result.length)
    throw new ReadError('duplicate_id');
  return result;
}
/** Public commercial offerings, not verified account inference access. Group SKU variants. */
export async function listServerless(
  _key: string,
  signal: AbortSignal,
  get: GetJSON = getJSON,
): Promise<ListedModel[]> {
  const rows = await pages(
    'products',
    'control',
    '/product-catalog/v2alpha1/public-catalog/products?product_types=generative_apis&region=fr-par',
    '',
    signal,
    get,
  );
  const models = new Map<string, Set<string>>();
  const skus = new Set<string>();
  for (const value of rows) {
    const row = record(value);
    const properties = record(row.properties);
    record(properties.generative_apis);
    if (
      !text(row.sku) ||
      !text(row.product) ||
      !text(row.status) ||
      record(row.locality).region !== 'fr-par'
    )
      throw new ReadError('invalid_response');
    if (skus.has(row.sku)) throw new ReadError('duplicate_id');
    skus.add(row.sku);
    const statuses = models.get(row.product) ?? new Set<string>();
    statuses.add(row.status);
    models.set(row.product, statuses);
  }
  return [...models]
    .map(([id, statuses]) => ({
      id,
      label: id,
      kind: 'serverless' as const,
      status: [...statuses].sort().join(' / '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
export async function listDedicatedCatalog(
  project: Project,
  key: string,
  signal: AbortSignal,
  get: GetJSON = getJSON,
): Promise<ListedModel[]> {
  if (!uuid(project.id) || !uuid(project.organizationId))
    throw new ReadError('invalid_scope');
  const rows = await pages(
    'models',
    'control',
    '/inference/v1/regions/fr-par/models?project_id=' +
      project.id +
      '&organization_id=' +
      project.organizationId,
    key,
    signal,
    get,
  );
  const result = rows.map((value) => {
    const row = record(value);
    if (
      !uuid(row.id) ||
      !text(row.name) ||
      row.region !== 'fr-par' ||
      (row.project_id !== project.id &&
        row.project_id !== '00000000-0000-0000-0000-000000000000')
    )
      throw new ReadError('foreign_or_invalid_scope');
    return {
      id: row.id,
      label: row.name,
      kind: 'dedicated-catalog' as const,
      ...(row.nodes_support !== undefined || row.has_eula !== undefined
        ? { dedicatedInfo: parseDedicatedModelInfo(row) }
        : {}),
      status:
        (row.project_id === project.id
          ? 'Projet · '
          : 'Catalogue fournisseur · ') +
        (text(row.status) ? row.status : 'unknown'),
    };
  });
  if (new Set(result.map((m) => m.id)).size !== result.length)
    throw new ReadError('duplicate_id');
  return result;
}
export async function listDedicated(
  project: Project,
  key: string,
  signal: AbortSignal,
  get: GetJSON = getJSON,
): Promise<ListedModel[]> {
  if (!uuid(project.id) || !uuid(project.organizationId))
    throw new ReadError('invalid_scope');
  const rows = await pages(
    'deployments',
    'control',
    '/inference/v1/regions/fr-par/deployments?project_id=' +
      encodeURIComponent(project.id) +
      '&organization_id=' +
      encodeURIComponent(project.organizationId),
    key,
    signal,
    get,
  );
  const result = rows.map((value) => {
    const row = record(value);
    if (
      !uuid(row.id) ||
      !text(row.name) ||
      row.project_id !== project.id ||
      row.region !== 'fr-par'
    )
      throw new ReadError('foreign_or_invalid_scope');
    return {
      id: row.id,
      label: row.name,
      kind: 'dedicated' as const,
      status: text(row.status) ? row.status : 'unknown',
    };
  });
  if (new Set(result.map((m) => m.id)).size !== result.length)
    throw new ReadError('duplicate_id');
  return result;
}

/** Preserve exact compatibility bits/context; never infer precision from model names. */
export function parseDedicatedModelInfo(value: unknown): DedicatedModelInfo {
  const row = record(value);
  if (row.has_eula !== undefined && typeof row.has_eula !== 'boolean')
    throw new ReadError('invalid_response');
  const supportedNodes: SupportedNode[] = [];
  const seen = new Map<string, SupportedNode>();
  if (row.nodes_support !== undefined) {
    if (!Array.isArray(row.nodes_support) || row.nodes_support.length > 32)
      throw new ReadError('invalid_response');
    for (const value of row.nodes_support) {
      const group = record(value);
      if (!Array.isArray(group.nodes) || group.nodes.length > 128)
        throw new ReadError('invalid_response');
      for (const value of group.nodes) {
        const node = record(value);
        if (
          !text(node.node_type_name) ||
          !Array.isArray(node.quantizations) ||
          node.quantizations.length > 32
        )
          throw new ReadError('invalid_response');
        for (const value of node.quantizations) {
          const quantization = record(value);
          const bits = quantization.quantization_bits;
          const context = quantization.max_context_size;
          if (
            !Number.isSafeInteger(bits) ||
            Number(bits) < 1 ||
            Number(bits) > 128 ||
            !Number.isSafeInteger(context) ||
            Number(context) < 0 ||
            typeof quantization.allowed !== 'boolean'
          )
            throw new ReadError('invalid_response');
          const entry = {
            nodeTypeName: node.node_type_name,
            quantizationBits: Number(bits),
            allowed: quantization.allowed,
            maxContextSize: Number(context),
          };
          const key = `${node.node_type_name}:${bits}`;
          const existing = seen.get(key);
          if (
            existing &&
            (existing.allowed !== entry.allowed ||
              existing.maxContextSize !== entry.maxContextSize)
          )
            throw new ReadError('conflicting_compatibility');
          if (!existing) {
            supportedNodes.push(entry);
            seen.set(key, entry);
          }
          if (supportedNodes.length > 1024)
            throw new ReadError('response_limit');
        }
      }
    }
  }
  return {
    status: text(row.status) ? row.status : 'unknown',
    hasEula: row.has_eula as boolean | undefined,
    supportedNodes,
  };
}
/** Regional hardware inventory only; stock is not quota, price or allocation proof. */
export async function listNodeTypes(
  key: string,
  signal: AbortSignal,
  get: GetJSON = getJSON,
): Promise<NodeType[]> {
  const rows = await pages(
    'node_types',
    'control',
    '/inference/v1/regions/fr-par/node-types?include_disabled_types=true',
    key,
    signal,
    get,
  );
  const result = rows.map((value) => {
    const row = record(value);
    if (
      !text(row.name) ||
      !text(row.stock_status) ||
      typeof row.disabled !== 'boolean' ||
      row.region !== 'fr-par'
    )
      throw new ReadError('foreign_or_invalid_scope');
    return {
      name: row.name,
      stockStatus: row.stock_status,
      disabled: row.disabled,
      region: 'fr-par' as const,
    };
  });
  if (new Set(result.map((row) => row.name)).size !== result.length)
    throw new ReadError('duplicate_id');
  return result;
}
