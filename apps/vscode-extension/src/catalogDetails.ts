import { visibleCatalogModels } from './catalogVisibility';
import { type ListedModel, serverlessInvocation } from './provider';
export function catalogDetails(
  rows: ListedModel[],
  kind: 'serverless' | 'dedicated-catalog',
  id: string,
  scope: string,
) {
  const row = visibleCatalogModels(rows).find(
    (model) => model.kind === kind && model.id === id,
  );
  if (!row) return;
  return {
    type: 'catalog-details' as const,
    label: row.label,
    status: row.status ?? 'Statut inconnu',
    prices: (row.serverlessPrices ?? []).filter(
      (price) => kind === 'serverless' && price.consumptionMode === 'realtime',
    ),
    pricingNote:
      kind === 'serverless'
        ? 'Tarifs publics · temps réel'
        : 'Tarif selon la configuration · affiché avant confirmation du déploiement',
    source:
      kind === 'serverless'
        ? 'Catalogue public Scaleway'
        : 'Catalogue dédié Scaleway',
    scope:
      kind === 'serverless' ? 'Serverless · offre publique · fr-par' : scope,
    limits:
      kind === 'serverless'
        ? serverlessInvocation(row)
          ? 'Utiliser prépare l’accès avec la clé API active et vérifie la liste API, sans inférence. Exécuter dans le playground lance un appel potentiellement facturé.'
          : 'Chat texte non applicable à cette offre ; aucune substitution de modèle.'
        : 'Déployer : choisir la configuration, puis confirmer le coût et la licence.',
  };
}
