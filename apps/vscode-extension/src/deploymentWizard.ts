import * as vscode from 'vscode';
import {
  corroboratedPublicPrice,
  type DedicatedPriceObservation,
} from './dedicatedPrices';
import {
  type DeploymentNetwork,
  deploymentOptions,
  prepareDeploymentDraft,
  validHourlyCeiling,
} from './deployment';
import {
  type ListedModel,
  type NodeType,
  type Project,
  text,
  uuid,
} from './provider';
/** Native preparation wizard only. No cloud write client is available here. */
export async function deploymentWizard(
  project: Project,
  model: ListedModel,
  nodes: NodeType[],
  current: () => boolean,
  prices: DedicatedPriceObservation[] = [],
): Promise<boolean> {
  if (!current()) return false;
  const options = deploymentOptions(model, nodes);
  if (!options.length) {
    await vscode.window.showWarningMessage(
      'Aucune configuration compatible actuellement préparable : vérifiez statut ready, compatibilités, stock et types de nœuds activés. Aucune création.',
    );
    return false;
  }
  const picked = await vscode.window.showQuickPick(
    options.map((option) => ({
      label: option.nodeTypeName,
      description: `${option.quantizationBits} bits · contexte ${option.maxContextSize}`,
      detail: [
        priceDescription(option.nodeTypeName, prices),
        'quota inconnu',
      ].join(' · '),
      option,
    })),
    {
      title: `1/4 · Préparer ${model.label}`,
      placeHolder: 'Choisir une infrastructure compatible (aucune allocation)',
    },
  );
  if (!picked || !current()) return false;
  const name = await vscode.window.showInputBox({
    title: '2/4 · Nom du futur déploiement',
    value: 'model-preview',
    prompt: 'Nom descriptif ; aucun déploiement ne sera créé.',
    validateInput: (value) =>
      text(value)
        ? undefined
        : 'Nom requis, 1–256 caractères, sans caractères de contrôle.',
  });
  if (!name || !current()) return false;
  const networkPick = await vscode.window.showQuickPick(
    [
      { label: 'Endpoint public protégé par IAM', id: 'public' as const },
      { label: 'Endpoint privé protégé par IAM', id: 'private' as const },
    ],
    {
      title: '3/4 · Réseau du futur endpoint',
      placeHolder: 'Aucun endpoint ouvert sans authentification',
    },
  );
  if (!networkPick || !current()) return false;
  let network: DeploymentNetwork = { type: 'public', authentication: 'iam' };
  if (networkPick.id === 'private') {
    const privateNetworkId = await vscode.window.showInputBox({
      title: 'Private Network existant',
      prompt:
        'UUID du réseau privé à vérifier avant création (aucun réseau créé).',
      validateInput: (value) =>
        uuid(value) ? undefined : 'UUID de Private Network requis.',
    });
    if (!privateNetworkId || !current()) return false;
    network = { type: 'private', authentication: 'iam', privateNetworkId };
  }
  const maxHourlyEUR = await vscode.window.showInputBox({
    title: '4/4 · Plafond horaire de préparation (EUR)',
    prompt:
      'Votre limite, pas un tarif ni une autorisation de dépense. Prix réel et quota restent à vérifier.',
    validateInput: (value) =>
      validHourlyCeiling(value)
        ? undefined
        : 'Montant positif, point décimal, maximum 4 décimales.',
  });
  if (!maxHourlyEUR || !current()) return false;
  const observedPrice = prices.find(
    (price) => price.nodeTypeName === picked.option.nodeTypeName,
  );
  const draft = prepareDeploymentDraft(project, model, nodes, {
    name,
    option: picked.option,
    network,
    maxHourlyEUR,
  });
  const choice = await vscode.window.showInformationMessage(
    `Préparation : ${model.label} · ${picked.option.nodeTypeName} · ${project.name} / fr-par. Ouvrir le plan local ? Prix/quota/licence non validés ; aucune ressource créée.`,
    { modal: true },
    'Ouvrir le plan local',
  );
  if (choice !== 'Ouvrir le plan local' || !current()) return false;
  const document = await vscode.workspace.openTextDocument({
    language: 'json',
    content: JSON.stringify(
      {
        ...draft,
        publicPriceObservation: observedPrice ?? null,
        corroboratedPublicEstimate: observedPrice
          ? (corroboratedPublicPrice(observedPrice) ?? null)
          : null,
        priceLimitations:
          'Prix public EUR par node ; période absente du catalogue seul. Une corroboration publique épinglée peut fournir un équivalent horaire exact, pas un tarif horaire effectif du compte. Facturation dédiée à la durée, y compris sans trafic (FAQ Scaleway). Charges additionnelles possibles. Aucun plafond de dépense appliqué.',
      },
      null,
      2,
    ),
  });
  if (!current()) return false;
  await vscode.window.showTextDocument(document, { preview: false });
  return true;
}

function priceDescription(
  node: string,
  prices: DedicatedPriceObservation[],
): string {
  const price = prices.find((row) => row.nodeTypeName === node);
  const estimate = price ? corroboratedPublicPrice(price) : undefined;
  if (estimate)
    return [
      estimate.minuteEUR,
      'EUR/min · équivalent',
      estimate.hourlyEquivalentEUR,
      'EUR/h HT (source publique épinglée, prix compte inconnu)',
    ].join(' ');
  return price
    ? [
        price.amountEUR,
        'EUR / node (catalogue public, période non précisée)',
      ].join(' ')
    : 'Prix public indisponible';
}
