import type { BatchSchedule, GeneratedBatchSchedule } from '../schemas/batch-schedule';
import type { WeeklyPlan } from '../schemas/weekly-plan';
import type { ConstraintViolation } from './plan-constraints';

/**
 * Ce qu'un déroulé doit tenir pour être servi.
 *
 * Deux règles, et elles suffisent : chaque étape doit viser un plat du batch,
 * et chaque plat du batch doit apparaître. La seconde est celle qui compte — un
 * modèle qui fond quatre recettes en une séquence peut en perdre une en route,
 * et l'on s'en apercevrait devant les fourneaux, avec un plat jamais cuisiné.
 */
export function validateBatchSchedule(
  schedule: GeneratedBatchSchedule,
  batchRecipeIds: readonly string[],
): ConstraintViolation[] {
  const batch = new Set(batchRecipeIds);
  const covered = new Set<string>();
  const violations: ConstraintViolation[] = [];

  schedule.steps.forEach((step, index) => {
    for (const recipeId of step.recipeIds) {
      if (batch.has(recipeId)) {
        covered.add(recipeId);
      } else {
        violations.push({
          code: 'schedule-unknown-recipe',
          message: `Étape ${index + 1} : « ${recipeId} » n'est pas un plat du batch.`,
        });
      }
    }
  });

  for (const recipeId of batch) {
    if (!covered.has(recipeId)) {
      violations.push({
        code: 'schedule-missing-recipe',
        message: `Le plat « ${recipeId} » n'apparaît dans aucune étape : il ne serait jamais cuisiné.`,
      });
    }
  }

  return violations;
}

/**
 * Vrai si le déroulé décrit encore le batch du plan.
 *
 * Remplacer un plat, ou recomposer la semaine, rend le déroulé faux sans que
 * rien ne l'efface. Le comparer au plan au moment de l'afficher est la seule
 * garantie qui ne dépende pas de la mémoire de chaque écrivain.
 */
export function isScheduleCurrent(schedule: BatchSchedule, plan: WeeklyPlan): boolean {
  const source = schedule.sourceRecipeIds;
  const current = plan.batchRecipeIds;
  return source.length === current.length && source.every((id, index) => id === current[index]);
}
