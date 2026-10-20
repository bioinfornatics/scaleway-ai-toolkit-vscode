import { visibleCatalogModels } from './catalogVisibility';
import type { ListedModel } from './provider';
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
    source:
      kind === 'serverless'
        ? 'Source : catalogue commercial public Scaleway · variantes regroupées par produit'
        : 'Source : catalogue de modèles dédiés Scaleway · fr-par',
    scope:
      kind === 'serverless' ? 'Serverless · offre publique · fr-par' : scope,
    limits:
      kind === 'serverless'
        ? 'Accès inférence non vérifié. Prix, capacités et identifiant d’invocation non établis par cette source. Le playground actuel est uniquement une démonstration hors ligne, pas un test de ce modèle.'
        : 'Modèle disponible au catalogue dédié, pas un déploiement existant. La préparation locale est disponible via la carte ; aucune allocation ni inférence n’est exécutée.',
  };
}
