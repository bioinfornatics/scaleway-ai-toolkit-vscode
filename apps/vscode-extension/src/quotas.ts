import {
  type GetJSON,
  getJSON,
  pages,
  ReadError,
  text,
  uuid,
} from './provider';
export type QuotaBound =
  | { kind: 'limited'; value: string }
  | { kind: 'unlimited' };
export type QuotaLocality =
  | { kind: 'global' }
  | { kind: 'region' | 'zone'; name: string };
export interface QuotaEvidence {
  name: string;
  prettyName: string;
  unit: string | undefined;
  localityType: 'global' | 'region' | 'zone' | undefined;
  legacy: QuotaBound | undefined;
  limits: Array<{ locality: QuotaLocality; bound: QuotaBound }>;
  usage: 'unknown';
  remaining: 'unknown';
}
export interface QuotaSnapshot {
  version: 1;
  mode: 'organization-quota-evidence';
  organizationId: string;
  fetchedAt: string;
  quota: QuotaEvidence[];
  dedicatedNodeMapping: 'unverified';
  createRights: 'unverified';
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ReadError('invalid_quota_response');
  return value as Record<string, unknown>;
}
/** Reject unsafe numeric JSON rather than recovering rounded uint64 values. */
export function quotaInteger(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new ReadError('invalid_quota_integer');
    return value.toString();
  }
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(value) ||
    BigInt(value) > 18446744073709551615n
  )
    throw new ReadError('invalid_quota_integer');
  return value;
}
function bound(
  row: Record<string, unknown>,
  optional = false,
): QuotaBound | undefined {
  const limited = row.limit !== undefined && row.limit !== null;
  const unlimited = row.unlimited !== undefined && row.unlimited !== null;
  if (!limited && !unlimited && optional) return;
  if (limited === unlimited || (unlimited && row.unlimited !== true))
    throw new ReadError('invalid_quota_bound');
  return limited
    ? { kind: 'limited', value: quotaInteger(row.limit) }
    : { kind: 'unlimited' };
}
function locality(row: Record<string, unknown>): QuotaLocality {
  const fields = ['global', 'region', 'zone'].filter(
    (field) => row[field] !== undefined && row[field] !== null,
  );
  if (fields.length !== 1) throw new ReadError('invalid_quota_locality');
  const field = fields[0];
  if (field === 'global') {
    if (row.global !== true) throw new ReadError('invalid_quota_locality');
    return { kind: 'global' };
  }
  const value = row[field];
  if (!text(value) || !/^[a-z]{2}-[a-z]+(?:-[1-9][0-9]?)?$/.test(value))
    throw new ReadError('invalid_quota_locality');
  if (field === 'region' && /-[0-9]+$/.test(value))
    throw new ReadError('invalid_quota_locality');
  if (field === 'zone' && !/-[0-9]+$/.test(value))
    throw new ReadError('invalid_quota_locality');
  return { kind: field === 'region' ? 'region' : 'zone', name: value };
}
export function parseQuota(value: unknown): QuotaEvidence {
  const row = record(value);
  if (
    !text(row.name) ||
    !text(row.pretty_name) ||
    (row.unit !== undefined && row.unit !== null && !text(row.unit)) ||
    (row.locality_type !== undefined &&
      !['global', 'region', 'zone'].includes(String(row.locality_type)))
  )
    throw new ReadError('invalid_quota_response');
  const raw = row.limits ?? [];
  if (!Array.isArray(raw) || raw.length > 100)
    throw new ReadError('invalid_quota_response');
  const limits = raw.map((value) => {
    const item = record(value);
    const scope = locality(item);
    if (row.locality_type !== undefined && scope.kind !== row.locality_type)
      throw new ReadError('invalid_quota_locality');
    const ceiling = bound(item);
    if (!ceiling) throw new ReadError('invalid_quota_bound');
    return { locality: scope, bound: ceiling };
  });
  const keys = limits.map((item) => JSON.stringify(item.locality));
  if (new Set(keys).size !== keys.length)
    throw new ReadError('duplicate_quota_locality');
  const legacy = bound(row, true);
  if (!legacy && !limits.length) throw new ReadError('missing_quota_bound');
  return {
    name: row.name,
    prettyName: row.pretty_name,
    unit: typeof row.unit === 'string' ? row.unit : undefined,
    localityType: row.locality_type as QuotaEvidence['localityType'],
    legacy,
    limits,
    usage: 'unknown',
    remaining: 'unknown',
  };
}
/** Organization-wide evidence; never filters by guessed pretty names or asserts project capacity. */
export async function listQuotaEvidence(
  organizationId: string,
  token: string,
  signal: AbortSignal,
  get: GetJSON = getJSON,
  now = new Date(),
): Promise<QuotaSnapshot> {
  if (!uuid(organizationId)) throw new ReadError('invalid_scope');
  const raw = await pages(
    'quota',
    'control',
    '/iam/v1alpha1/quota?organization_id=' +
      encodeURIComponent(organizationId) +
      '&order_by=name_asc',
    token,
    signal,
    get,
  );
  const quota = raw.map(parseQuota);
  if (new Set(quota.map((row) => row.name)).size !== quota.length)
    throw new ReadError('duplicate_quota_name');
  return {
    version: 1,
    mode: 'organization-quota-evidence',
    organizationId,
    fetchedAt: now.toISOString(),
    quota,
    dedicatedNodeMapping: 'unverified',
    createRights: 'unverified',
  };
}
