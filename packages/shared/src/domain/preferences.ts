import type { Recipe } from '../schemas/recipe';

/** Ce que le foyer peut penser d'une recette, en dehors de l'indifférence. */
const RECIPE_VERDICTS = ['favorite', 'banned'] as const;
export type RecipeVerdict = (typeof RECIPE_VERDICTS)[number];

/**
 * Les recettes du foyer rangées par verdict.
 *
 * Les deux listes sont les deux faces du même champ : un plat passe de l'une à
 * l'autre, jamais dans les deux. Les produire ensemble, et les indexer par le
 * verdict lui-même, est ce qui permet à l'écran de choisir sa liste sans
 * rebrancher sur la valeur.
 */
export type HouseholdTastes = Record<RecipeVerdict, Recipe[]>;

/** Les deux verdicts du foyer, triés par nom, en une seule passe. */
export function splitByVerdict(recipes: Iterable<Recipe>): HouseholdTastes {
  const tastes: HouseholdTastes = { favorite: [], banned: [] };

  for (const recipe of recipes) {
    // Le rejet l'emporte. Les Security Rules bornent les champs modifiables,
    // pas leur cohérence : un plat à la fois favori et banni reste possible, et
    // le serveur tranche déjà dans le même sens (`readFavoriteRecipeNames`).
    if (recipe.isDisliked) tastes.banned.push(recipe);
    else if (recipe.isFavorite) tastes.favorite.push(recipe);
  }

  for (const verdict of RECIPE_VERDICTS) {
    tastes[verdict].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  return tastes;
}
