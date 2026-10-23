import { Buffer } from 'node:buffer';

export const REAL_OUTPUT_BYTES = 2 * 1024 * 1024;
// Allows worst-case JSON escaping of a transport-sized output, but remains bounded.
export const REAL_EXPERIMENT_BYTES = 16 * 1024 * 1024;
export interface RealService {
  readonly kind: 'serverless' | 'dedicated';
  readonly organizationId: string;
  readonly projectId: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly destination: string;
  readonly authentication: 'iam' | 'disabled';
  readonly region?: 'fr-par';
  readonly deploymentId?: string;
  readonly endpointId?: string;
  readonly endpointUrl?: string;
}
export interface RealUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
}
export const REAL_FAILURE_CODES = [
  'endpoint_policy',
  'invalid_input',
  'invalid_credentials',
  'aborted',
  'timeout',
  'idle_timeout',
  'http_error',
  'network_error',
  'provider_error',
  'invalid_stream',
  'model_mismatch',
  'response_too_large',
  'frame_too_large',
  'unexpected_eof',
  'callback_error',
  'access_denied',
] as const;
export interface RealFailure {
  readonly code: (typeof REAL_FAILURE_CODES)[number];
  readonly status?: number;
}
/** Only allowlisted codes and HTTP error status; never messages or bodies. */
export function sanitizeRealFailure(
  code: unknown,
  status?: unknown,
): RealFailure {
  const safeCode =
    REAL_FAILURE_CODES.find((candidate) => candidate === code) ??
    'access_denied';
  return {
    code: safeCode,
    ...(safeCode === 'http_error' &&
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
      ? { status }
      : {}),
  };
}
export interface RealCost {
  readonly actual: 'unknown';
  readonly billing: 'token' | 'deployment-duration';
  readonly publicEstimate?: Readonly<{
    source: 'public-catalog';
    currency: 'EUR';
    display: string;
    retrievedAt: 'unknown' | string;
  }>;
  readonly estimate?: Readonly<{
    source: 'public-catalog';
    currency: 'EUR';
    amount: number;
    retrievedAt: string;
  }>;
}
export interface RealExperiment {
  readonly version: 1;
  readonly mode: 'real-provider';
  readonly status: 'completed' | 'cancelled' | 'failed' | 'partial';
  readonly timestamp: string;
  readonly service: Readonly<RealService>;
  readonly prompt: string;
  readonly maxTokens: number;
  readonly output: string;
  readonly execution: Readonly<{
    environment: 'local-mock' | 'live';
    billed: 'none' | 'unknown' | 'possible';
    status?: string;
  }>;
  readonly failure?: Readonly<RealFailure>;
  readonly usage?: Readonly<RealUsage>;
  readonly cost?: Readonly<RealCost>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
function keys(
  v: unknown,
  required: string[],
  optional: string[] = [],
): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(v);
  return (
    required.every((k) => Object.hasOwn(v, k)) &&
    own.every(
      (k) =>
        typeof k === 'string' &&
        (required.includes(k) || optional.includes(k)) &&
        Object.getOwnPropertyDescriptor(v, k)?.enumerable === true &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value'),
    )
  );
}
function utf8(v: unknown, max: number, nonempty = false): v is string {
  if (
    typeof v !== 'string' ||
    (nonempty && !v.trim()) ||
    v.length > max ||
    Buffer.byteLength(v, 'utf8') > max
  )
    return false;
  // Reject unpaired surrogates: encoding must never silently replace source data.
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(v)) === v;
}
function timestamp(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v
  );
}
function count(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}
function service(v: unknown): boolean {
  const required = [
    'kind',
    'organizationId',
    'projectId',
    'modelId',
    'modelName',
    'destination',
    'authentication',
  ];
  if (
    !keys(v, required, [
      'region',
      'deploymentId',
      'endpointId',
      'endpointUrl',
    ]) ||
    typeof v.organizationId !== 'string' ||
    !UUID.test(v.organizationId) ||
    typeof v.projectId !== 'string' ||
    !UUID.test(v.projectId) ||
    typeof v.modelId !== 'string' ||
    !MODEL.test(v.modelId) ||
    typeof v.modelName !== 'string' ||
    !MODEL.test(v.modelName)
  )
    return false;
  if (v.kind === 'serverless')
    return (
      keys(v, required) &&
      v.authentication === 'iam' &&
      v.destination === serverlessDestination(v.projectId)
    );
  if (
    v.kind !== 'dedicated' ||
    !keys(v, [
      ...required,
      'region',
      'deploymentId',
      'endpointId',
      'endpointUrl',
    ]) ||
    v.region !== 'fr-par' ||
    !UUID.test(v.modelId) ||
    typeof v.deploymentId !== 'string' ||
    !UUID.test(v.deploymentId) ||
    typeof v.endpointId !== 'string' ||
    !UUID.test(v.endpointId) ||
    !['iam', 'disabled'].includes(v.authentication as string) ||
    typeof v.endpointUrl !== 'string'
  )
    return false;
  // Same narrow public hostname/base-path restriction as dedicatedInvocationPolicy.
  // Snapshot import is NOT endpoint approval, IAM/reachability proof, or spend consent.
  const origin = `https://${v.deploymentId.toLowerCase()}.ifr.fr-par.scaleway.com`;
  return (
    ['', '/', '/v1', '/v1/'].some((path) => v.endpointUrl === origin + path) &&
    v.destination === `${origin}/v1/chat/completions`
  );
}
function serverlessDestination(project: string): string {
  return `https://api.scaleway.ai/${project}/v1/chat/completions`;
}
function freeze(v: unknown): void {
  if (v && typeof v === 'object') {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
}
/** Data-only strict snapshot. No credentials/headers/extensions, no invocation or consent. */
export function parseRealExperiment(
  value: unknown,
): RealExperiment | undefined {
  try {
    if (
      !keys(
        value,
        [
          'version',
          'mode',
          'status',
          'timestamp',
          'service',
          'prompt',
          'maxTokens',
          'output',
          'execution',
        ],
        ['usage', 'cost', 'failure'],
      ) ||
      value.version !== 1 ||
      value.mode !== 'real-provider' ||
      !['completed', 'cancelled', 'failed', 'partial'].includes(
        value.status as string,
      ) ||
      !timestamp(value.timestamp) ||
      !service(value.service) ||
      !(utf8(value.prompt, 12288, true) && value.prompt.length <= 4096) ||
      !utf8(value.output, REAL_OUTPUT_BYTES) ||
      !count(value.maxTokens) ||
      value.maxTokens < 1 ||
      value.maxTokens > 2048 ||
      !keys(value.execution, ['environment', 'billed'], ['status'])
    )
      return;
    const e = value.execution;
    if (
      !(e.environment === 'local-mock' && e.billed === 'none') &&
      !(
        e.environment === 'live' &&
        ['unknown', 'possible'].includes(e.billed as string)
      )
    )
      return;
    if (Object.hasOwn(e, 'status') && !utf8(e.status, 1024, true)) return;
    if (Object.hasOwn(value, 'failure')) {
      const f = value.failure;
      if (
        !['failed', 'partial', 'cancelled'].includes(value.status as string) ||
        !keys(f, ['code'], ['status']) ||
        !REAL_FAILURE_CODES.includes(f.code as RealFailure['code']) ||
        (Object.hasOwn(f, 'status') &&
          (f.code !== 'http_error' ||
            typeof f.status !== 'number' ||
            !Number.isInteger(f.status) ||
            f.status < 400 ||
            f.status > 599))
      )
        return;
    }
    if (Object.hasOwn(value, 'usage')) {
      const u = value.usage;
      if (
        !keys(
          u,
          ['inputTokens', 'outputTokens', 'totalTokens'],
          ['cachedInputTokens'],
        ) ||
        !count(u.inputTokens) ||
        !count(u.outputTokens) ||
        !count(u.totalTokens) ||
        u.inputTokens + u.outputTokens !== u.totalTokens ||
        (Object.hasOwn(u, 'cachedInputTokens') &&
          (!count(u.cachedInputTokens) || u.cachedInputTokens > u.inputTokens))
      )
        return;
    }
    if (Object.hasOwn(value, 'cost')) {
      const c = value.cost;
      if (
        !keys(c, ['actual', 'billing'], ['estimate', 'publicEstimate']) ||
        c.actual !== 'unknown' ||
        c.billing !==
          ((value.service as Record<string, unknown>).kind === 'dedicated'
            ? 'deployment-duration'
            : 'token')
      )
        return;
      if (Object.hasOwn(c, 'publicEstimate')) {
        const estimate = c.publicEstimate;
        if (
          c.billing !== 'token' ||
          !keys(estimate, ['source', 'currency', 'display', 'retrievedAt']) ||
          estimate.source !== 'public-catalog' ||
          estimate.currency !== 'EUR' ||
          !utf8(estimate.display, 256, true) ||
          !/^[0-9]+\.[0-9]{9} EUR estimés HT \(tarif public, non facture\)$/.test(
            estimate.display,
          ) ||
          !(
            estimate.retrievedAt === 'unknown' ||
            timestamp(estimate.retrievedAt)
          )
        )
          return;
      }
      if (Object.hasOwn(c, 'estimate')) {
        const estimate = c.estimate;
        if (
          c.billing !== 'token' ||
          !keys(estimate, ['source', 'currency', 'amount', 'retrievedAt']) ||
          estimate.source !== 'public-catalog' ||
          estimate.currency !== 'EUR' ||
          typeof estimate.amount !== 'number' ||
          !Number.isFinite(estimate.amount) ||
          estimate.amount < 0 ||
          !timestamp(estimate.retrievedAt)
        )
          return;
      }
    }
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > REAL_EXPERIMENT_BYTES) return;
    const fresh = JSON.parse(serialized) as RealExperiment;
    freeze(fresh);
    return fresh;
  } catch {
    return;
  }
}
export function decodeRealExperiment(
  bytes: Uint8Array,
): RealExperiment | undefined {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > REAL_EXPERIMENT_BYTES
  )
    return;
  try {
    return parseRealExperiment(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
  } catch {
    return;
  }
}
export function encodeRealExperiment(experiment: RealExperiment): Uint8Array {
  const parsed = parseRealExperiment(experiment);
  if (!parsed) throw new Error('invalid_real_experiment');
  // Compact encoding keeps the same bound guaranteed by parse.
  return Buffer.from(JSON.stringify(parsed), 'utf8');
}
