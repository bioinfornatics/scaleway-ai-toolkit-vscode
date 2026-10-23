import * as vscode from 'vscode';
import {
  type DedicatedEndpointApproval,
  dedicatedInvocationPolicy,
} from './dedicatedInvocationPolicy';
import type { DeploymentEndpoint, ListedModel, Project } from './provider';

/** Product UI policy, not a cloud-agent mandate or authorization to spend. */
export const DEDICATED_CONSENT_VALIDITY_MS = 30 * 60 * 1000;
/** Native host UI only. No credentials, HTTP, probe, persistence or automatic Run. */
export async function dedicatedConsent(
  deployment: ListedModel,
  project: Project,
  current: () => boolean = () => true,
  now: () => number = Date.now,
): Promise<DedicatedEndpointApproval | undefined> {
  deployment = structuredClone(deployment);
  project = structuredClone(project);
  const approvalFor = (
    endpoint: DeploymentEndpoint,
  ): DedicatedEndpointApproval => ({
    organizationId: project.organizationId,
    projectId: project.id,
    region: 'fr-par',
    deploymentId: deployment.id,
    endpointId: endpoint.id,
    endpointUrl: endpoint.url,
    modelName: deployment.deploymentInfo?.modelName ?? '',
    authentication: endpoint.authentication,
    allowUnauthenticated: endpoint.authentication === 'disabled',
    approvedAt: now(),
    expiresAt: now() + DEDICATED_CONSENT_VALIDITY_MS,
  });
  if (!current()) return;
  const endpoints = deployment.deploymentInfo?.endpoints;
  const choices =
    Array.isArray(endpoints) && endpoints.length <= 32
      ? endpoints.filter(
          (endpoint) =>
            dedicatedInvocationPolicy(
              deployment,
              project,
              approvalFor(endpoint),
              now(),
            ).allowed,
        )
      : [];
  if (!choices.length) {
    await vscode.window.showWarningMessage(
      'Aucun endpoint public dédié admissible. Réseau privé, état non prêt ou métadonnées invalides : appel bloqué.',
    );
    return;
  }
  const selected = await vscode.window.showQuickPick(
    choices.map((endpoint) => ({
      label: endpoint.url,
      description:
        endpoint.authentication === 'iam'
          ? 'IAM · clé API requise'
          : 'Authentification désactivée · aucun jeton envoyé',
      detail: 'Endpoint ' + endpoint.id,
      endpoint,
    })),
    {
      title: 'Sélectionner un endpoint public dédié',
      placeHolder: 'Aucune requête réseau · aucune exécution automatique',
    },
  );
  if (!selected || !current()) return;
  const endpoint = selected.endpoint;
  const confirm =
    endpoint.authentication === 'disabled'
      ? 'Approuver cet endpoint sans authentification'
      : 'Approuver cet endpoint IAM';
  const accepted = await vscode.window.showWarningMessage(
    'Confirmer l’endpoint dédié exact',
    {
      modal: true,
      detail: [
        'Organisation : ' + project.organizationId,
        'Projet : ' + project.name + ' · ' + project.id,
        'Déploiement : ' + deployment.label + ' · ' + deployment.id,
        'Modèle : ' + deployment.deploymentInfo?.modelName,
        'Région : fr-par · endpoint : ' + endpoint.id,
        'URL exacte : ' + endpoint.url,
        endpoint.authentication === 'iam'
          ? 'Authentification IAM : clé API envoyée uniquement lors de Run.'
          : 'Authentification DÉSACTIVÉE : endpoint public sans authentification, aucun jeton envoyé.',
        'Validité : 30 minutes après confirmation (politique produit UI, PAS un mandat cloud agent).',
        'Connectivité et droits non vérifiés. Facturation à la durée du déploiement, pas aux tokens. Arrêter localement ne garantit pas l’arrêt distant ni de la facturation.',
        'Approuver ouvre seulement le panel. Seul Exécuter / Run lance une inférence. Aucune exécution automatique.',
      ].join('\n'),
    },
    confirm,
  );
  if (accepted !== confirm || !current()) return;
  const approval = approvalFor(endpoint);
  return dedicatedInvocationPolicy(deployment, project, approval, now()).allowed
    ? approval
    : undefined;
}
