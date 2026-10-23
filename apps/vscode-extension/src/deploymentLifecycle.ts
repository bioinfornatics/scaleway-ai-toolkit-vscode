import { type ListedModel, type Project, ReadError, uuid } from './provider';

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
