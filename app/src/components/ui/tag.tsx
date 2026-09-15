import type { RecipeTag } from '@dimanche-batch/shared';
import { Badge, type BadgeTone } from './badge';

const TAG_LABELS: Record<RecipeTag, string> = {
  'one-pot': 'one-pot',
  healthy: 'healthy',
  congelable: 'congèle',
  rapide: 'rapide',
  vegetarien: 'végé',
  batch: 'batch',
  weekend: 'week-end',
  entree: 'entrée',
  dessert: 'dessert',
  mijote: 'mijoté',
  'four-lent': 'four',
};

/**
 * Ce qu'une étiquette de recette vaut en couleur.
 *
 * `congelable` est ambre : il porte une conséquence pratique, sortir le plat la
 * veille. `mijote` et `four-lent` sont violets : ils disent quel plat lancer en
 * premier le dimanche. Le reste est vert.
 */
const TAG_TONES: Partial<Record<RecipeTag, BadgeTone>> = {
  congelable: 'spice',
  weekend: 'weekend',
  mijote: 'weekend',
  'four-lent': 'weekend',
};

export interface TagProps {
  tag: RecipeTag;
}

export function Tag({ tag }: TagProps) {
  return <Badge label={TAG_LABELS[tag]} tone={TAG_TONES[tag] ?? 'accent'} />;
}
