import type { Recipe } from '../schemas/recipe';

/**
 * Ce que le foyer aime et ce qu'il refuse.
 *
 * Les deux listes sont les deux faces du même champ : un plat passe de l'une à
 * l'autre, jamais dans les deux. Les produire ensemble est ce qui rend cette
 * exclusivité visible — deux filtres séparés laisseraient croire à deux notions
 * indépendantes.
 */
export interface HouseholdTastes {
  favorites: Recipe[];
  banned: Recipe[];
}

/** Les deux verdicts du foyer, triés par nom, en une seule passe. */
export function splitByVerdict(recipes: Iterable<Recipe>): HouseholdTastes {
  const favorites: Recipe[] = [];
  const banned: Recipe[] = [];

  for (const recipe of recipes) {
    // Le rejet l'emporte. Les Security Rules bornent les champs modifiables,
    // pas leur cohérence : un plat à la fois favori et banni reste possible, et
    // le serveur tranche déjà dans le même sens (`readFavoriteRecipeNames`).
    if (recipe.isDisliked) banned.push(recipe);
    else if (recipe.isFavorite) favorites.push(recipe);
  }

  return { favorites: sortByName(favorites), banned: sortByName(banned) };
}

function sortByName(recipes: Recipe[]): Recipe[] {
  return recipes.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
