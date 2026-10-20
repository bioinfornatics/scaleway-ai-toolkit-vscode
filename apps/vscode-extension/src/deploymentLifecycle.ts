import { randomUUID } from 'node:crypto';
import {
  type DeploymentDraft,
  prepareDeploymentDraft,
  validHourlyCeiling,
} from './deployment';
import {
  type ListedModel,
  type NodeType,
  type Project,
  parseDeployment,
  ReadError,
  text,
  uuid,
} from './provider';

export type OperationStatus =
  | 'prepared'
  | 'submitting'
  | 'accepted'
  | 'unknown'
  | 'rejected';
export interface DeploymentOperation {
  version: 1;
  id: string;
  projectId: string;
  organizationId: string;
  modelId: string;
  name: string;
  region: 'fr-par';
  status: OperationStatus;
  deploymentId?: string;
}
export interface DeploymentReview {
  reviewedAt: number;
  hourlyPriceEUR: string;
  priceSource: string;
  quota: 'verified-for-one-node';
  quotaSource: string;
  rights: 'verified-create';
  writeContract: 'verified';
  license:
    | { kind: 'no-eula-reviewed' }
    | { kind: 'eula-reviewed-and-accepted'; digest: string };
  exposureConfirmed: true;
  billableCreationConfirmed: true;
}
/** Exact source-derived body. A user ceiling is not provider pricing or authorization. */
export interface CreateDeploymentBody {
  name: string;
  project_id: string;
  model_id: string;
  node_type_name: string;
  tags: string[];
  min_size: 1;
  max_size: 1;
  quantization: { bits: number };
  endpoints: Array<{
    disable_auth: false;
    public_network?: Record<string, never>;
    private_network?: { private_network_id: string };
  }>;
  accept_eula?: true;
}
const reviewedBodies = new WeakMap<
  CreateDeploymentBody,
  { serialized: string; expiresAt: number }
>();
function decimalUnits(value: string): bigint {
  if (!validHourlyCeiling(value)) throw new ReadError('unverified_price');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
}
export function reviewedDeploymentBody(
  draft: DeploymentDraft,
  project: Project,
  model: ListedModel,
  nodes: NodeType[],
  review: DeploymentReview,
  now = Date.now(),
): CreateDeploymentBody {
  // Revalidate against trusted current scope/model/hardware, not fields imported from a file.
  const candidate = prepareDeploymentDraft(project, model, nodes, {
    name: draft.name,
    option: draft.infrastructure,
    network: draft.network,
    maxHourlyEUR: draft.budget.maxHourlyEUR,
  });
  if (
    draft.project.id !== project.id ||
    draft.project.organizationId !== project.organizationId ||
    draft.model.id !== model.id ||
    draft.region !== 'fr-par' ||
    !Number.isSafeInteger(review.reviewedAt) ||
    review.reviewedAt > now ||
    now - review.reviewedAt > 60000 ||
    review.quota !== 'verified-for-one-node' ||
    !text(review.quotaSource) ||
    !text(review.priceSource) ||
    review.rights !== 'verified-create' ||
    review.writeContract !== 'verified' ||
    review.exposureConfirmed !== true ||
    review.billableCreationConfirmed !== true
  )
    throw new ReadError('deployment_review_required');
  if (
    decimalUnits(review.hourlyPriceEUR) >
    decimalUnits(candidate.budget.maxHourlyEUR)
  )
    throw new ReadError('price_exceeds_ceiling');
  const hasEula = model.dedicatedInfo?.hasEula;
  if (
    hasEula === undefined ||
    (hasEula &&
      (review.license.kind !== 'eula-reviewed-and-accepted' ||
        !/^[a-f0-9]{64}$/.test(review.license.digest))) ||
    (!hasEula && review.license.kind !== 'no-eula-reviewed')
  )
    throw new ReadError('license_review_required');
  const body: CreateDeploymentBody = {
    name: candidate.name,
    project_id: project.id,
    model_id: model.id,
    node_type_name: candidate.infrastructure.nodeTypeName,
    tags: [],
    min_size: 1,
    max_size: 1,
    quantization: { bits: candidate.infrastructure.quantizationBits },
    endpoints: [
      candidate.network.type === 'public'
        ? { disable_auth: false, public_network: {} }
        : {
            disable_auth: false,
            private_network: {
              private_network_id: candidate.network.privateNetworkId,
            },
          },
    ],
    ...(hasEula ? { accept_eula: true as const } : {}),
  };
  reviewedBodies.set(body, {
    serialized: JSON.stringify(body),
    expiresAt: review.reviewedAt + 60000,
  });
  return body;
}
export type OperationStore = (operation: DeploymentOperation) => Promise<void>;
export type ReviewedCreationTransport = (
  body: CreateDeploymentBody,
  signal: AbortSignal,
) => Promise<unknown>;
/** No production transport is wired yet. Unknown/submitting operations can never be resubmitted. */
export class DeploymentLifecycle {
  private operation: DeploymentOperation;
  private busy = false;
  constructor(
    project: Project,
    model: ListedModel,
    name: string,
    private store: OperationStore,
    private post: ReviewedCreationTransport,
    id = randomUUID(),
  ) {
    if (
      !uuid(project.id) ||
      !uuid(project.organizationId) ||
      !uuid(model.id) ||
      !text(name) ||
      !uuid(id)
    )
      throw new ReadError('invalid_scope');
    this.operation = {
      version: 1,
      id,
      projectId: project.id,
      organizationId: project.organizationId,
      modelId: model.id,
      name,
      region: 'fr-par',
      status: 'prepared',
    };
  }
  get snapshot(): DeploymentOperation {
    return { ...this.operation };
  }
  async submit(
    body: CreateDeploymentBody,
    signal: AbortSignal,
  ): Promise<ListedModel> {
    if (this.busy || this.operation.status !== 'prepared')
      throw new ReadError('reconcile_before_retry');
    if (signal.aborted) throw new ReadError('cancelled');
    if (
      body.project_id !== this.operation.projectId ||
      body.model_id !== this.operation.modelId ||
      body.name !== this.operation.name
    )
      throw new ReadError('foreign_or_invalid_scope');
    const approved = reviewedBodies.get(body);
    if (
      !approved ||
      approved.expiresAt < Date.now() ||
      JSON.stringify(body) !== approved.serialized
    )
      throw new ReadError('deployment_review_required');
    const payload: CreateDeploymentBody = JSON.parse(approved.serialized);
    this.busy = true;
    try {
      this.operation.status = 'submitting';
      // Write-ahead record must succeed BEFORE any physical creation send.
      try {
        await this.store(this.snapshot);
      } catch {
        this.operation.status = 'prepared';
        throw new ReadError('operation_storage_unavailable');
      }
      if (signal.aborted) {
        this.operation.status = 'prepared';
        await this.store(this.snapshot);
        throw new ReadError('cancelled');
      }
      if (approved.expiresAt < Date.now()) {
        this.operation.status = 'prepared';
        await this.store(this.snapshot);
        throw new ReadError('deployment_review_required');
      }
      let value: unknown;
      try {
        value = await this.post(payload, signal);
      } catch (error) {
        this.operation.status =
          error instanceof ReadError &&
          ['access_denied', 'creation_rejected', 'rate_limited'].includes(
            error.code,
          )
            ? 'rejected'
            : 'unknown';
        await this.store(this.snapshot);
        throw error instanceof ReadError
          ? error
          : new ReadError('creation_outcome_unknown');
      }
      let row: ListedModel;
      try {
        row = parseDeployment(value, {
          id: this.operation.projectId,
          organizationId: this.operation.organizationId,
          name: 'Selected project',
        });
        if (
          row.deploymentInfo?.modelId !== this.operation.modelId ||
          row.label !== this.operation.name ||
          row.deploymentInfo.nodeTypeName !== body.node_type_name
        )
          throw new ReadError('creation_outcome_unknown');
      } catch {
        this.operation.status = 'unknown';
        await this.store(this.snapshot);
        throw new ReadError('creation_outcome_unknown');
      }
      this.operation = {
        ...this.operation,
        status: 'accepted',
        deploymentId: row.id,
      };
      try {
        await this.store(this.snapshot);
      } catch {
        throw new ReadError('accepted_operation_storage_unavailable');
      }
      return row; // Accepted does NOT mean ready/reachable/inference-tested.
    } finally {
      this.busy = false;
    }
  }
}
export type FollowResult = {
  state: 'ready' | 'failed' | 'deleted' | 'pending' | 'cancelled';
  reads: number;
  resource?: ListedModel;
};
export type DeploymentRead = (
  project: Project,
  id: string,
  signal: AbortSignal,
) => Promise<ListedModel>;
export function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new ReadError('cancelled'));
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new ReadError('cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
/** Explicit follow action only: five sequential GETs, no retries/writes/probes. */
export async function followDeployment(
  project: Project,
  id: string,
  signal: AbortSignal,
  read: DeploymentRead,
  onUpdate: (resource: ListedModel) => void,
  delay = (signal: AbortSignal) => abortableDelay(15000, signal),
): Promise<FollowResult> {
  if (!uuid(project.id) || !uuid(project.organizationId) || !uuid(id))
    throw new ReadError('invalid_scope');
  let resource: ListedModel | undefined,
    reads = 0;
  for (let index = 0; index < 5; index++) {
    if (signal.aborted) return { state: 'cancelled', reads, resource };
    reads++;
    try {
      resource = await read(project, id, signal);
    } catch (error) {
      if (signal.aborted) return { state: 'cancelled', reads, resource };
      throw error;
    }
    if (signal.aborted) return { state: 'cancelled', reads, resource };
    if (
      resource.kind !== 'dedicated' ||
      resource.id !== id ||
      resource.deploymentInfo?.projectId !== project.id ||
      resource.deploymentInfo.region !== 'fr-par'
    )
      throw new ReadError('foreign_or_invalid_scope');
    onUpdate(resource);
    if (resource.status === 'ready') return { state: 'ready', reads, resource };
    if (resource.status === 'error' || resource.status === 'locked')
      return { state: 'failed', reads, resource };
    if (resource.status === 'deleted')
      return { state: 'deleted', reads, resource };
    if (index < 4) {
      try {
        await delay(signal);
      } catch (error) {
        if (signal.aborted) return { state: 'cancelled', reads, resource };
        throw error;
      }
    }
  }
  return { state: 'pending', reads, resource };
}
