import { addDays, normalizeName, paths } from '@dimanche-batch/shared';
import { db } from './firestore';

/**
 * Ce que le foyer a déjà mangé, aimé et rejeté.
 *
 * Trois listes de sens différents partent dans le prompt, et elles doivent
 * rester cohérentes entre elles — un plat ne peut pas être à la fois recommandé
 * et interdit. Les composer au même endroit est la seule façon de le garantir ;
 * dispersées dans les callables, elles finiraient par diverger.
 */

/** Nombre de semaines passées consultées pour éviter les répétitions. */
const HISTORY_WEEKS = 3;

/** Au-delà, la liste noierait le reste du prompt. */
const MAX_FAVORITES_IN_PROMPT = 8;

/**
 * Plafond de lecture des plats bannis. Voir CLAUDE.md §9 : au-delà, la
 * garantie se dégrade silencieusement, et l'extension est une pagination.
 */
const BANNED_READ_LIMIT = 200;

export interface HouseholdMemory {
  recentRecipeNames: string[];
  favoriteRecipeNames: string[];
  bannedRecipeNames: string[];
}

/**
 * Les trois listes pour une génération complète.
 *
 * L'ordre compte : les favoris se calculent à partir des récentes, et les deux
 * s'effacent devant les bannies.
 */
export async function readHouseholdMemory(
  householdId: string,
  weekStart: string,
): Promise<HouseholdMemory> {
  const recentRecipeNames = await readRecentRecipeNames(householdId, weekStart);
  const bannedRecipeNames = await readBannedRecipeNames(householdId);
  const favoriteRecipeNames = await readFavoriteRecipeNames(
    householdId,
    recentRecipeNames,
    bannedRecipeNames,
  );

  return { recentRecipeNames, favoriteRecipeNames, bannedRecipeNames };
}

/**
 * Noms des recettes servies lors des semaines précédentes.
 *
 * On lit les plans plutôt que la collection `recipes` : une recette peut
 * exister dans le foyer sans avoir été servie récemment, et c'est bien la
 * répétition rapprochée qu'on cherche à éviter, pas la réutilisation.
 */
async function readRecentRecipeNames(
  householdId: string,
  weekStart: string,
): Promise<string[]> {
  const weekIds = Array.from({ length: HISTORY_WEEKS }, (_, index) =>
    addDays(weekStart, -7 * (index + 1)),
  );

  const plans = await Promise.all(
    weekIds.map((weekId) => db.doc(paths.weeklyPlan(householdId, weekId)).get()),
  );

  const recipeIds = new Set<string>();
  for (const plan of plans) {
    if (!plan.exists) continue;
    const ids = plan.get('recipeIds');
    if (Array.isArray(ids)) ids.forEach((id) => typeof id === 'string' && recipeIds.add(id));
  }
  if (recipeIds.size === 0) return [];

  const recipes = await Promise.all(
    [...recipeIds].map((id) => db.doc(paths.recipe(householdId, id)).get()),
  );

  return recipes
    .map((recipe) => recipe.get('name'))
    .filter((name): name is string => typeof name === 'string');
}

/**
 * Plats que le foyer ne veut plus voir.
 *
 * La projection `select('name')` est là pour ce que la requête ne rapatrie
 * pas : ingrédients et étapes n'ont rien à faire dans un prompt qui ne veut
 * que des noms.
 */
export async function readBannedRecipeNames(householdId: string): Promise<string[]> {
  const snapshot = await db
    .collection(paths.recipes(householdId))
    .where('isDisliked', '==', true)
    .select('name')
    .limit(BANNED_READ_LIMIT)
    .get();

  return snapshot.docs
    .map((doc) => doc.get('name'))
    .filter((name): name is string => typeof name === 'string');
}

/**
 * Favoris du foyer, hors de ceux déjà servis récemment ou bannis.
 *
 * Un favori mangé la semaine dernière n'a pas à revenir tout de suite : le
 * retirer ici évite de demander au modèle une chose et son contraire. Un plat
 * à la fois favori et banni est un état que les Security Rules ne peuvent pas
 * interdire à elles seules — le rejet l'emporte, faute de quoi le prompt
 * porterait la consigne et son inverse.
 */
export async function readFavoriteRecipeNames(
  householdId: string,
  recentRecipeNames: string[],
  bannedRecipeNames: string[] = [],
): Promise<string[]> {
  const recent = new Set(recentRecipeNames);
  const banned = new Set(bannedRecipeNames.map(normalizeName));

  const snapshot = await db
    .collection(paths.recipes(householdId))
    .where('isFavorite', '==', true)
    .limit(MAX_FAVORITES_IN_PROMPT * 2)
    .get();

  return snapshot.docs
    .map((doc) => doc.get('name'))
    .filter(
      (name): name is string =>
        typeof name === 'string' && !recent.has(name) && !banned.has(normalizeName(name)),
    )
    .slice(0, MAX_FAVORITES_IN_PROMPT);
}
