import {
  type ListedModel,
  type NodeType,
  type Project,
  ReadError,
  text,
  uuid,
} from './provider';
export interface DeploymentOption {
  nodeTypeName: string;
  quantizationBits: number;
  maxContextSize: number;
  stockStatus: 'available' | 'low_stock';
}
export type DeploymentNetwork =
  | { type: 'public'; authentication: 'iam' }
  | { type: 'private'; authentication: 'iam'; privateNetworkId: string };
export interface DeploymentDraft {
  version: 1;
  mode: 'dedicated-deployment-preparation';
  createdAt: string;
  project: Project;
  region: 'fr-par';
  model: { id: string; name: string; status: string };
  infrastructure: DeploymentOption & { nodes: 1 };
  name: string;
  network: DeploymentNetwork;
  budget: { maxHourlyEUR: string; source: 'user-ceiling-not-provider-price' };
  license: { hasEula: boolean | undefined; accepted: false };
  checks: {
    price: 'unknown';
    quota: 'unknown';
    allocation: 'not_requested';
    providerWriteContract: 'not_verified';
  };
  executable: false;
  blockers: string[];
}
export function deploymentOptions(
  model: ListedModel,
  nodes: NodeType[],
): DeploymentOption[] {
  if (
    model.kind !== 'dedicated-catalog' ||
    !uuid(model.id) ||
    model.dedicatedInfo?.status !== 'ready'
  )
    return [];
  const hardware = new Map(nodes.map((node) => [node.name, node]));
  return model.dedicatedInfo.supportedNodes.flatMap((support) => {
    const node = hardware.get(support.nodeTypeName);
    if (
      !support.allowed ||
      support.maxContextSize <= 0 ||
      !node ||
      node.region !== 'fr-par' ||
      node.disabled ||
      (node.stockStatus !== 'available' && node.stockStatus !== 'low_stock')
    )
      return [];
    return [
      {
        nodeTypeName: node.name,
        quantizationBits: support.quantizationBits,
        maxContextSize: support.maxContextSize,
        stockStatus: node.stockStatus,
      },
    ];
  });
}
export function validHourlyCeiling(value: string): boolean {
  return (
    /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,4})?$/.test(value) &&
    /[1-9]/.test(value)
  );
}
export function prepareDeploymentDraft(
  project: Project,
  model: ListedModel,
  nodes: NodeType[],
  input: {
    name: string;
    option: DeploymentOption;
    network: DeploymentNetwork;
    maxHourlyEUR: string;
  },
  now = new Date(),
): DeploymentDraft {
  if (
    !uuid(project.id) ||
    !uuid(project.organizationId) ||
    !text(project.name) ||
    !text(input.name) ||
    !validHourlyCeiling(input.maxHourlyEUR)
  )
    throw new ReadError('invalid_preparation');
  const option = deploymentOptions(model, nodes).find(
    (candidate) =>
      candidate.nodeTypeName === input.option.nodeTypeName &&
      candidate.quantizationBits === input.option.quantizationBits &&
      candidate.maxContextSize === input.option.maxContextSize &&
      candidate.stockStatus === input.option.stockStatus,
  );
  if (!option || !model.dedicatedInfo)
    throw new ReadError('incompatible_or_unavailable_node');
  if (
    input.network.authentication !== 'iam' ||
    (input.network.type !== 'public' && input.network.type !== 'private') ||
    (input.network.type === 'private' && !uuid(input.network.privateNetworkId))
  )
    throw new ReadError('invalid_network');
  const network: DeploymentNetwork =
    input.network.type === 'public'
      ? { type: 'public', authentication: 'iam' }
      : {
          type: 'private',
          authentication: 'iam',
          privateNetworkId: input.network.privateNetworkId,
        };
  return {
    version: 1,
    mode: 'dedicated-deployment-preparation',
    createdAt: now.toISOString(),
    project: {
      id: project.id,
      name: project.name,
      organizationId: project.organizationId,
    },
    region: 'fr-par',
    model: {
      id: model.id,
      name: model.label,
      status: model.dedicatedInfo.status,
    },
    infrastructure: { ...option, nodes: 1 },
    name: input.name,
    network,
    budget: {
      maxHourlyEUR: input.maxHourlyEUR,
      source: 'user-ceiling-not-provider-price',
    },
    license: { hasEula: model.dedicatedInfo.hasEula, accepted: false },
    checks: {
      price: 'unknown',
      quota: 'unknown',
      allocation: 'not_requested',
      providerWriteContract: 'not_verified',
    },
    executable: false,
    blockers: [
      'Prix horaire dédié non vérifié (le plafond saisi n’est pas un prix).',
      'Quota et droits de création non vérifiés ; le stock ne garantit pas une allocation.',
      'Contrat de création et réconciliation à vérifier avant tout POST.',
      ...(model.dedicatedInfo.hasEula !== false
        ? ['Conditions EULA à récupérer et examiner ; aucune licence acceptée.']
        : []),
      'Confirmation finale de création facturée non donnée ; ce document ne crée aucune ressource.',
    ],
  };
}
