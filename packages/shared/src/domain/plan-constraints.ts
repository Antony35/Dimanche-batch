import type { GeneratedPlan } from '../schemas/gemini';
import { isWeekday } from './week';

/**
 * Règles de la semaine type. Un JSON syntaxiquement valide peut décrire un plan
 * inutilisable — trois fois la même recette, aucune recette congelable, un
 * gratin de deux heures un mardi soir. Ces contraintes sont vérifiées côté
 * Cloud Function avant toute écriture Firestore, et un échec déclenche l'unique
 * retry autorisé, en réinjectant les violations dans le prompt.
 */

export interface ConstraintViolation {
  code: string;
  message: string;
}

/** Nombre minimum de recettes distinctes réellement cuisinées dans la semaine. */
export const MIN_DISTINCT_RECIPES = 3;
/** Filet de sécurité pour les repas sautés (resto, soir sans faim). */
export const MIN_FREEZABLE_RECIPES = 2;
/** Au-delà, une recette de semaine n'est plus compatible avec une soirée ordinaire. */
export const MAX_WEEKDAY_PREP_MINUTES = 45;

export function validateGeneratedPlan(plan: GeneratedPlan): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const recipesBySlug = new Map(plan.recipes.map((recipe) => [recipe.slug, recipe]));

  if (recipesBySlug.size !== plan.recipes.length) {
    violations.push({
      code: 'duplicate-slug',
      message: 'Deux recettes partagent le même slug.',
    });
  }

  const dayIndices = new Set(plan.days.map((day) => day.dayIndex));
  if (dayIndices.size !== 7) {
    violations.push({
      code: 'day-index',
      message: 'Les 7 jours doivent porter les dayIndex 0 à 6, sans doublon.',
    });
  }

  const referencedSlugs = new Set<string>();
  const cookedSlugs = new Set<string>();

  for (const day of plan.days) {
    for (const [slot, meal] of [
      ['midi', day.lunch],
      ['soir', day.dinner],
    ] as const) {
      const label = `jour ${day.dayIndex} (${slot})`;

      if (meal.recipeSlug === null) {
        if (meal.kind !== 'eat-out') {
          violations.push({
            code: 'missing-recipe',
            message: `${label} : un repas sans recette doit être de type eat-out.`,
          });
        }
        continue;
      }

      const recipe = recipesBySlug.get(meal.recipeSlug);
      if (!recipe) {
        violations.push({
          code: 'unknown-slug',
          message: `${label} : la recette « ${meal.recipeSlug} » n'est pas déclarée.`,
        });
        continue;
      }

      referencedSlugs.add(recipe.slug);
      if (meal.kind === 'cooked') {
        cookedSlugs.add(recipe.slug);

        if (isWeekday(day.dayIndex)) {
          if (!recipe.tags.includes('one-pot')) {
            violations.push({
              code: 'weekday-not-one-pot',
              message: `${label} : « ${recipe.name} » doit être one-pot en semaine.`,
            });
          }
          if (recipe.prepMinutes > MAX_WEEKDAY_PREP_MINUTES) {
            violations.push({
              code: 'weekday-too-long',
              message: `${label} : ${recipe.prepMinutes} min dépasse les ${MAX_WEEKDAY_PREP_MINUTES} min tolérées en semaine.`,
            });
          }
        }
      }
    }
  }

  if (cookedSlugs.size < MIN_DISTINCT_RECIPES) {
    violations.push({
      code: 'not-enough-variety',
      message: `Seulement ${cookedSlugs.size} recettes cuisinées distinctes, il en faut ${MIN_DISTINCT_RECIPES}.`,
    });
  }

  const freezableCount = plan.recipes.filter(
    (recipe) => referencedSlugs.has(recipe.slug) && recipe.tags.includes('congelable'),
  ).length;
  if (freezableCount < MIN_FREEZABLE_RECIPES) {
    violations.push({
      code: 'not-enough-freezable',
      message: `Seulement ${freezableCount} recette(s) congelable(s), il en faut ${MIN_FREEZABLE_RECIPES}.`,
    });
  }

  for (const recipe of plan.recipes) {
    if (!referencedSlugs.has(recipe.slug)) {
      violations.push({
        code: 'orphan-recipe',
        message: `La recette « ${recipe.name} » n'est utilisée aucun jour.`,
      });
    }
  }

  return violations;
}

/** Rendu compact des violations, réinjecté dans le prompt lors du retry. */
export function describeViolations(violations: ConstraintViolation[]): string {
  return violations.map((violation) => `- ${violation.message}`).join('\n');
}
