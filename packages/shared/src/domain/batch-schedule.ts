import type { CookingSession, GeneratedCookingSession } from '../schemas/batch-schedule';
import type { Recipe } from '../schemas/recipe';
import type { WeeklyPlan } from '../schemas/weekly-plan';
import { cookTimeViolations, type ConstraintViolation } from './plan-constraints';
import { singularIngredientName } from './mise-en-place';
import { normalizeName } from './text';

/**
 * Gestes de découpe. Une étape de cuisson qui **commence** par l'un d'eux n'a
 * pas été réécrite : tout est déjà coupé à ce stade. « Commence par »
 * seulement, pour laisser passer « Ajouter les oignons émincés ».
 */
const PREP_VERBS: ReadonlySet<string> = new Set([
  'eplucher',
  'emincer',
  'couper',
  'decouper',
  'hacher',
  'ciseler',
  'raper',
  'peler',
  'tailler',
  'laver',
  'trancher',
]);

/**
 * Ce qu'une session doit tenir pour être servie.
 *
 * La faute la plus grave est un plat sans étape : on s'en apercevrait devant
 * les fourneaux. Viennent ensuite ce qui trahirait une réécriture ratée — une
 * étape qui redemande de couper, une découpe d'un ingrédient que la recette ne
 * contient pas.
 */
export function validateBatchSession(
  session: GeneratedCookingSession,
  recipes: readonly Pick<Recipe, 'id' | 'name' | 'ingredients'>[],
): ConstraintViolation[] {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const violations: ConstraintViolation[] = [];
  const withSteps = new Set<string>();

  session.steps.forEach((step, index) => {
    if (!byId.has(step.recipeId)) {
      violations.push({
        code: 'session-unknown-recipe',
        message: `Étape ${index + 1} : « ${step.recipeId} » n'est pas un plat du batch.`,
      });
      return;
    }
    withSteps.add(step.recipeId);

    const firstWord =
      normalizeName(step.text)
        .split(/[^a-z]+/)
        .find(Boolean) ?? '';
    if (PREP_VERBS.has(firstWord)) {
      violations.push({
        code: 'session-prep-step',
        message: `Étape « ${step.text} » : tout est déjà coupé, ne garde que la cuisson et le mélange.`,
      });
    }
  });

  for (const cut of session.cuts) {
    const recipe = byId.get(cut.recipeId);
    if (!recipe) {
      violations.push({
        code: 'session-unknown-recipe',
        message: `Découpe « ${cut.ingredient} » : « ${cut.recipeId} » n'est pas un plat du batch.`,
      });
      continue;
    }
    const known = recipe.ingredients.some(
      (ingredient) =>
        singularIngredientName(ingredient.name) === singularIngredientName(cut.ingredient),
    );
    if (!known) {
      violations.push({
        code: 'session-unknown-ingredient',
        message: `Découpe de « ${cut.ingredient} » : ce n'est pas un ingrédient de « ${cut.recipeId} ». Reprends le nom exact de la recette.`,
      });
    }
  }

  for (const recipe of recipes) {
    if (!withSteps.has(recipe.id)) {
      violations.push({
        code: 'session-missing-recipe',
        message: `Le plat « ${recipe.id} » n'a aucune étape de cuisson : il ne serait jamais cuisiné.`,
      });
    }

    const timing = session.timings.find((candidate) => candidate.recipeId === recipe.id);
    if (!timing) {
      violations.push({
        code: 'session-missing-timing',
        message: `Le plat « ${recipe.id} » n'a pas de temps de cuisson dans "timings".`,
      });
      continue;
    }
    const steps = session.steps
      .filter((step) => step.recipeId === recipe.id)
      .map((step) => step.text);
    violations.push(...cookTimeViolations(recipe.name, steps, timing.cookMinutes));
  }

  return violations;
}

/**
 * Temps de cuisson seule d'un plat pour l'écran : celui de la session, qui
 * concorde avec les étapes affichées, ou celui de la recette à défaut.
 */
export function sessionCookMinutes(
  session: Pick<CookingSession, 'timings'> | null,
  recipe: Pick<Recipe, 'id' | 'cookMinutes'>,
): number {
  return (
    session?.timings.find((timing) => timing.recipeId === recipe.id)?.cookMinutes ??
    recipe.cookMinutes
  );
}

/**
 * Vrai si la session décrit encore le batch du plan.
 *
 * Remplacer un plat, ou recomposer la semaine, la rend fausse sans que rien ne
 * l'efface. La comparer au plan au moment de l'afficher est la seule garantie
 * qui ne dépende pas de la mémoire de chaque écrivain.
 */
export function isScheduleCurrent(session: CookingSession, plan: WeeklyPlan): boolean {
  const source = session.sourceRecipeIds;
  const current = plan.batchRecipeIds;
  return source.length === current.length && source.every((id, index) => id === current[index]);
}
