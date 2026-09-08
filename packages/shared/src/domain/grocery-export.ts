import { AISLE_LABELS } from '../schemas/common';
import type { GroceryItem } from '../schemas/grocery-list';
import { groupByAisle } from './grocery';
import { formatQuantity } from './units';

export interface GroceryExportOptions {
  /** Inclure les articles déjà cochés. Faux par défaut : on partage le reste à acheter. */
  includeChecked?: boolean;
  /** En-têtes de rayon. Listonic les ignore, mais un humain les lit. */
  includeAisleHeaders?: boolean;
  title?: string;
}

/**
 * Rend la liste en texte brut pour le share sheet Android.
 *
 * Point d'extension v2 : si une intégration Listonic réelle apparaît, elle
 * remplace cette fonction sans toucher au reste de l'app — c'est la seule
 * frontière entre notre modèle et le format d'un tiers.
 */
export function formatGroceryListForSharing(
  items: GroceryItem[],
  options: GroceryExportOptions = {},
): string {
  const { includeChecked = false, includeAisleHeaders = true, title } = options;
  const visible = includeChecked ? items : items.filter((item) => !item.checked);
  if (visible.length === 0) return title ?? '';

  const lines: string[] = [];
  if (title) lines.push(title, '');

  for (const group of groupByAisle(visible)) {
    if (includeAisleHeaders) lines.push(`${AISLE_LABELS[group.aisle].toUpperCase()}`);
    for (const item of group.items) {
      lines.push(`${capitalize(item.name)} ${formatQuantity(item.qty, item.unit)}`.trim());
    }
    if (includeAisleHeaders) lines.push('');
  }

  return lines.join('\n').trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
