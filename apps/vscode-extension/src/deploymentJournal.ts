import type { DeploymentOperation } from './deploymentLifecycle';
import { type Project, ReadError, text, uuid } from './provider';

export interface JournalStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}
const statuses = new Set([
  'prepared',
  'submitting',
  'accepted',
  'unknown',
  'rejected',
]);
const fields = [
  'version',
  'id',
  'projectId',
  'organizationId',
  'modelId',
  'name',
  'region',
  'status',
];
function operation(value: unknown, project: Project): DeploymentOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ReadError('invalid_operation_journal');
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (
    keys.some((key) => !fields.includes(key) && key !== 'deploymentId') ||
    fields.some((key) => !Object.hasOwn(row, key)) ||
    row.version !== 1 ||
    !uuid(row.id) ||
    !uuid(row.modelId) ||
    row.projectId !== project.id ||
    row.organizationId !== project.organizationId ||
    row.region !== 'fr-par' ||
    !text(row.name) ||
    typeof row.status !== 'string' ||
    !statuses.has(row.status) ||
    (row.status === 'accepted'
      ? !uuid(row.deploymentId)
      : Object.hasOwn(row, 'deploymentId'))
  )
    throw new ReadError('invalid_operation_journal');
  return { ...row } as unknown as DeploymentOperation;
}
/** Metadata only, never credentials, prompts or creation payloads. No network/retry. */
export class DeploymentJournal {
  private tail: Promise<void> = Promise.resolve();
  private readonly currentSubmissions = new Set<string>();
  private readonly key: string;
  constructor(
    private storage: JournalStorage,
    userId: string,
    private project: Project,
  ) {
    if (!uuid(userId) || !uuid(project.id) || !uuid(project.organizationId))
      throw new ReadError('invalid_scope');
    this.project = { ...project };
    this.key =
      'scalewayAI.deploymentOperations.v1.' +
      userId +
      '.' +
      project.organizationId +
      '.' +
      project.id;
  }
  private read(): DeploymentOperation[] {
    const raw = this.storage.get(this.key);
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 100)
      throw new ReadError('invalid_operation_journal');
    const rows = raw.map((row) => operation(row, this.project));
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new ReadError('invalid_operation_journal');
    return rows;
  }
  async recover(): Promise<DeploymentOperation[]> {
    await this.tail;
    // A restart cannot distinguish a send in flight from an accepted lost response.
    return this.read().map((row) => ({
      ...row,
      status: row.status === 'submitting' ? 'unknown' : row.status,
    }));
  }
  save = (value: DeploymentOperation): Promise<void> => {
    // Snapshot synchronously: callers cannot mutate a queued write.
    let next: DeploymentOperation;
    try {
      next = operation(value, this.project);
    } catch (error) {
      return Promise.reject(error);
    }
    const write = this.tail.then(async () => {
      const rows = this.read();
      const index = rows.findIndex((row) => row.id === next.id);
      if (index < 0) {
        if (rows.length === 100) throw new ReadError('operation_journal_full');
        rows.push(next);
      } else {
        const previous = rows[index];
        if (
          previous.status === 'submitting' &&
          next.status === 'prepared' &&
          !this.currentSubmissions.has(next.id)
        )
          throw new ReadError('reconcile_before_retry');
        const allowed: Record<DeploymentOperation['status'], string[]> = {
          prepared: ['prepared', 'submitting'],
          submitting: [
            'prepared',
            'accepted',
            'unknown',
            'rejected',
            'submitting',
          ],
          accepted: ['accepted'],
          unknown: ['unknown'],
          rejected: ['rejected'],
        };
        if (
          previous.modelId !== next.modelId ||
          previous.name !== next.name ||
          !allowed[previous.status].includes(next.status) ||
          (previous.deploymentId && previous.deploymentId !== next.deploymentId)
        )
          throw new ReadError('invalid_operation_transition');
        rows[index] = next;
      }
      await this.storage.update(this.key, rows);
      if (next.status === 'submitting') this.currentSubmissions.add(next.id);
      else this.currentSubmissions.delete(next.id);
    });
    this.tail = write.catch(() => {});
    return write;
  };
}
