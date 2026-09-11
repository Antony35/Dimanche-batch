import type { BatchScheduleStep } from '../schemas/batch-schedule';
import type { Unit } from '../schemas/common';
import type { Recipe } from '../schemas/recipe';
import { ingredientKey } from './grocery';
import { normalizeName } from './text';
import { dimensionOf, toBaseQuantity } from './units';

/**
 * Qui prend quoi, quand on a tout coupé d'un coup.
 *
 * Le déroulé entrelacé regroupe les gestes semblables — « émincer les oignons
 * des deux plats » — mais une fois tout coupé, il faut répartir. Les quantités
 * existent déjà, exactes, recette par recette : le partage se **calcule**. Le
 * demander au modèle, qui peut se tromper en comptant, serait moins sûr et
 * coûterait une génération.
 *
 * Même agrégation que la liste de courses, et même clé : un ingrédient est
 * reconnu par son nom normalisé et la dimension de son unité. Des grammes et
 * des pièces du même légume restent deux lignes — les additionner n'aurait pas
 * de sens.
 */

interface IngredientShare {
  recipeId: string;
  qty: number;
  unit: Unit;
}

export interface SharedIngredient {
  /** Nom tel que la première recette l'écrit, accents compris. */
  name: string;
  total: { qty: number; unit: Unit };
  /** Une entrée par plat, deux au moins. */
  shares: IngredientShare[];
}

/** Ingrédients présents dans au moins deux des recettes, triés par nom. */
export function getSharedIngredients(recipes: Recipe[]): SharedIngredient[] {
  const byKey = new Map<string, SharedIngredient>();

  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const base = toBaseQuantity(ingredient.qty, ingredient.unit);
      const key = ingredientKey(ingredient.name, dimensionOf(ingredient.unit));
      const entry = byKey.get(key) ?? {
        name: ingredient.name.trim(),
        total: { qty: 0, unit: base.unit },
        shares: [],
      };

      entry.total.qty += base.qty;
      const share = entry.shares.find((candidate) => candidate.recipeId === recipe.id);
      if (share) share.qty += base.qty;
      else entry.shares.push({ recipeId: recipe.id, qty: base.qty, unit: base.unit });
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()]
    .filter((entry) => entry.shares.length >= 2)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/**
 * Partage à afficher sous une étape : restreint aux plats de l'étape, et aux
 * ingrédients qu'elle nomme.
 *
 * Une étape qui ne concerne qu'un plat n'a rien à répartir. Et une étape qui
 * désigne l'ingrédient autrement que la recette (« échalote » pour « oignon »)
 * n'affiche rien : c'est pour ce cas que la mise en place en tête existe.
 */
export function ingredientsForStep(
  step: BatchScheduleStep,
  shared: SharedIngredient[],
): SharedIngredient[] {
  const recipeIds = new Set(step.recipeIds);
  if (recipeIds.size < 2) return [];
  const words = wordsOf(step.text);

  return shared.flatMap((ingredient) => {
    const shares = ingredient.shares.filter((share) => recipeIds.has(share.recipeId));
    if (shares.length < 2 || !mentions(words, ingredient.name)) return [];
    const qty = shares.reduce((total, share) => total + share.qty, 0);
    return [{ ...ingredient, total: { qty, unit: ingredient.total.unit }, shares }];
  });
}

function wordsOf(text: string): string[] {
  return normalizeName(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Vrai si les mots du nom se suivent dans l'étape, chacun en préfixe : ainsi
 * « oignon » reconnaît « oignons », et « pomme de terre » reconnaît « pommes de
 * terre ». Le pluriel français se construit presque toujours par suffixe.
 */
function mentions(words: string[], name: string): boolean {
  const target = wordsOf(name);
  if (target.length === 0) return false;
  for (let start = 0; start + target.length <= words.length; start += 1) {
    if (target.every((word, offset) => (words[start + offset] ?? '').startsWith(word))) {
      return true;
    }
  }
  return false;
}
