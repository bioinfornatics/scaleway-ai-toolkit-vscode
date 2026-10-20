import type { ListedModel } from './provider';

/** Presentation only: keep raw API lifecycle and never hide existing resources. */
export function visibleCatalogModels(rows: ListedModel[]): ListedModel[] {
  const retired = new Set(['retired', 'end_of_life', 'eol']);
  return rows.filter((row) => {
    if (row.kind === 'dedicated' || !row.status) return true;
    const lifecycle = row.status.split(' · ').at(-1) ?? '';
    const statuses = lifecycle
      .split(' / ')
      .map((status) => status.trim().toLowerCase());
    return !statuses.every((status) => retired.has(status));
  });
}
