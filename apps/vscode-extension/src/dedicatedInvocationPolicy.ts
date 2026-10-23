import type { ListedModel, Project } from './provider';
import { uuid } from './provider';

/** Host-owned consent only: never accept this object from webview/workspace IPC.
 * This is endpoint trust, NOT a spend mandate or proof of reachability/IAM.
 */
export interface DedicatedEndpointApproval {
  organizationId: string;
  projectId: string;
  region: 'fr-par';
  deploymentId: string;
  endpointId: string;
  endpointUrl: string;
  modelName: string;
  authentication: 'iam' | 'disabled';
  allowUnauthenticated: boolean;
  approvedAt: number;
  expiresAt: number;
}
export type DedicatedPolicyFailure =
  | 'invalid_scope'
  | 'not_ready'
  | 'invalid_model'
  | 'invalid_approval'
  | 'expired_approval'
  | 'endpoint_unavailable'
  | 'private_or_unknown_network'
  | 'unsafe_endpoint'
  | 'approval_mismatch'
  | 'unauthenticated_not_approved';
export type DedicatedInvocationDecision =
  | { allowed: false; reason: DedicatedPolicyFailure }
  | {
      allowed: true;
      projectId: string;
      deploymentId: string;
      endpointId: string;
      modelName: string;
      url: string;
      authentication: 'iam' | 'disabled';
      reachable: 'unverified';
      billing: 'deployment-duration-not-token-estimate';
    };
const deny = (reason: DedicatedPolicyFailure): DedicatedInvocationDecision => ({
  allowed: false,
  reason,
});
function modelName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
  );
}

/** Pure validation: no DNS, certificate fetching, probe, credential access or send.
 * Initially supports ONLY the documented public deployment hostname shape.
 * Never constructs a base URL from an ID; uses the exact returned+approved URL.
 * Other provider domains/private networks remain blocked pending their policy.
 */
export function dedicatedInvocationPolicy(
  deployment: ListedModel,
  project: Project,
  approval: DedicatedEndpointApproval,
  now = Date.now(),
): DedicatedInvocationDecision {
  const info = deployment?.deploymentInfo;
  if (
    deployment?.kind !== 'dedicated' ||
    !uuid(deployment.id) ||
    !uuid(project?.id) ||
    !uuid(project.organizationId) ||
    info?.projectId !== project.id ||
    info.region !== 'fr-par'
  )
    return deny('invalid_scope');
  if (deployment.status !== 'ready') return deny('not_ready');
  // Dedicated chat expects the provider model name, NOT the catalogue UUID.
  if (!uuid(info.modelId) || !modelName(info.modelName))
    return deny('invalid_model');
  if (
    !approval ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(approval.approvedAt) ||
    !Number.isSafeInteger(approval.expiresAt) ||
    approval.approvedAt < 0 ||
    approval.expiresAt <= approval.approvedAt ||
    typeof approval.allowUnauthenticated !== 'boolean'
  )
    return deny('invalid_approval');
  if (now < approval.approvedAt || now >= approval.expiresAt)
    return deny('expired_approval');
  if (
    approval.organizationId !== project.organizationId ||
    approval.projectId !== project.id ||
    approval.region !== info.region ||
    approval.deploymentId !== deployment.id ||
    approval.modelName !== info.modelName ||
    !uuid(approval.endpointId)
  )
    return deny('approval_mismatch');
  if (!Array.isArray(info.endpoints) || info.endpoints.length > 32)
    return deny('endpoint_unavailable');
  const endpoints = info.endpoints.filter((e) => e?.id === approval.endpointId);
  if (endpoints.length !== 1) return deny('endpoint_unavailable');
  const endpoint = endpoints[0];
  if (endpoint.network !== 'public' || endpoint.privateNetworkId !== undefined)
    return deny('private_or_unknown_network');
  if (
    typeof endpoint.url !== 'string' ||
    endpoint.url.length > 2048 ||
    endpoint.url !== approval.endpointUrl ||
    endpoint.authentication !== approval.authentication ||
    !['iam', 'disabled'].includes(endpoint.authentication)
  )
    return deny('approval_mismatch');
  let base: URL;
  try {
    base = new URL(endpoint.url);
  } catch {
    return deny('unsafe_endpoint');
  }
  if (
    base.protocol !== 'https:' ||
    base.hostname !==
      `${deployment.id.toLowerCase()}.ifr.fr-par.scaleway.com` ||
    base.port ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !['/', '/v1', '/v1/'].includes(base.pathname) ||
    // Reject parser normalization, credentials syntax, queries and empty #/?.
    ![base.href, base.href.replace(/\/$/, '')].includes(endpoint.url)
  )
    return deny('unsafe_endpoint');
  if (endpoint.authentication === 'disabled' && !approval.allowUnauthenticated)
    return deny('unauthenticated_not_approved');
  // Append the source-backed operation to the returned base, not a guessed URL.
  base.pathname = '/v1/chat/completions';
  return {
    allowed: true,
    projectId: project.id,
    deploymentId: deployment.id,
    endpointId: endpoint.id,
    modelName: info.modelName,
    url: base.href,
    authentication: endpoint.authentication,
    reachable: 'unverified',
    billing: 'deployment-duration-not-token-estimate',
  };
}
