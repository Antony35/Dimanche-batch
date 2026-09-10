import type { GeneratedPlan, GeneratedRecipe } from '../schemas/gemini';
import type { MealStyle } from '../schemas/weekly-plan';
import { normalizeName } from './text';
import { isWeekday, requiresFreezing } from './week';

/**
 * Règles de la semaine type. Un JSON syntaxiquement valide peut décrire un plan
 * inutilisable — un batch qui ne couvre pas la semaine, un plat cuisiné un mardi
 * soir alors que le principe est de ne pas cuisiner en semaine. Ces contraintes
 * sont vérifiées côté Cloud Function avant toute écriture Firestore, et un échec
 * déclenche l'unique retry autorisé, en réinjectant les violations dans le prompt.
 *
 * Les messages sont chiffrés à dessein : c'est ce qui rend une seule reprise
 * suffisante, le modèle sachant alors de combien il s'est trompé.
 */

export interface ConstraintViolation {
  code: string;
  message: string;
}

/** Plats distincts préparés le dimanche. Le foyer choisit dans cet intervalle. */
export const MIN_BATCH_RECIPES = 3;
export const MAX_BATCH_RECIPES = 6;
/** Taille du foyer, en dur en v1. Voir CLAUDE.md §9. */
export const SERVINGS_PER_MEAL = 2;
/** La session du dimanche doit tenir dans un après-midi. */
export const MAX_BATCH_TOTAL_MINUTES = 240;
/** Au-delà, une recette cuisinée un soir de semaine n'est plus tenable. */
export const MAX_WEEKDAY_PREP_MINUTES = 45;

export interface PlanValidationOptions {
  /** Nombre de plats demandé par le foyer avant la génération. */
  expectedBatchCount?: number | undefined;
  /** Noms des plats que le foyer a bannis. Voir `bannedViolations`. */
  bannedNames?: readonly string[] | undefined;
}

export function validateGeneratedPlan(
  plan: GeneratedPlan,
  options: PlanValidationOptions = {},
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const recipesBySlug = new Map(plan.recipes.map((recipe) => [recipe.slug, recipe]));
  const batchSlugs = new Set(plan.batchRecipeSlugs);

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

  violations.push(...batchSizeViolations(plan, batchSlugs, options.expectedBatchCount));

  for (const slug of batchSlugs) {
    if (!recipesBySlug.has(slug)) {
      violations.push({
        code: 'batch-unknown-slug',
        message: `Le plat « ${slug} » du batch n'est pas déclaré dans les recettes.`,
      });
    }
  }

  const referencedSlugs = new Set<string>(batchSlugs);
  /** Nombre de repas servis par chaque plat du batch, pour vérifier les portions. */
  const servedCount = new Map<string, number>();
  /** Jours où chaque plat du batch est servi, pour la contrainte de congélation. */
  const servedDays = new Map<string, number[]>();

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
        if (isWeekday(day.dayIndex)) {
          violations.push({
            code: 'weekday-cooked',
            message: `${label} : on ne cuisine pas en semaine. Ce repas doit être une portion du batch.`,
          });
        }
        if (batchSlugs.has(recipe.slug)) {
          violations.push({
            code: 'cooked-is-batch-recipe',
            message: `${label} : « ${recipe.name} » est un plat du batch, donc une portion et non un plat cuisiné.`,
          });
        }
      }

      if (meal.kind === 'batch-leftover') {
        if (!batchSlugs.has(recipe.slug)) {
          violations.push({
            code: 'leftover-not-from-batch',
            message: `${label} : « ${recipe.name} » est servi en portion mais ne fait pas partie du batch.`,
          });
          continue;
        }
        servedCount.set(recipe.slug, (servedCount.get(recipe.slug) ?? 0) + 1);
        servedDays.set(recipe.slug, [...(servedDays.get(recipe.slug) ?? []), day.dayIndex]);
      }
    }
  }

  violations.push(...servingsViolations(recipesBySlug, servedCount));
  violations.push(...freezableViolations(recipesBySlug, servedDays));
  violations.push(...batchDurationViolations(recipesBySlug, batchSlugs));

  const banned = bannedIndex(options.bannedNames);
  for (const recipe of plan.recipes) {
    if (!referencedSlugs.has(recipe.slug)) {
      violations.push({
        code: 'orphan-recipe',
        message: `La recette « ${recipe.name} » n'est utilisée aucun jour.`,
      });
    }
    violations.push(...bannedViolations(recipe, banned));
  }

  return violations;
}

/**
 * Le foyer a explicitement rejeté ce plat, et le modèle le repropose quand même.
 *
 * Le filet est nécessaire parce qu'un modèle ignore parfois une contrainte
 * négative : sans lui, l'utilisateur se verrait servir le plat qu'il vient de
 * refuser, et la fonctionnalité perdrait tout crédit au premier ratage. La
 * violation part dans l'unique reprise de contenu, qui rappelle le nom fautif.
 *
 * La comparaison est une égalité normalisée, jamais un rapprochement flou : un
 * validateur approximatif refuserait des recettes légitimes, et chaque refus
 * coûte une reprise au foyer.
 */
function bannedViolations(recipe: GeneratedRecipe, banned: Set<string>): ConstraintViolation[] {
  if (!banned.has(normalizeName(recipe.name))) return [];

  return [
    {
      code: 'banned-recipe',
      message: `Le foyer a rejeté « ${recipe.name} » : ne propose ni ce plat ni une variante proche.`,
    },
  ];
}

function bannedIndex(names: readonly string[] | undefined): Set<string> {
  return new Set((names ?? []).map(normalizeName));
}

function batchSizeViolations(
  plan: GeneratedPlan,
  batchSlugs: Set<string>,
  expectedBatchCount: number | undefined,
): ConstraintViolation[] {
  if (batchSlugs.size !== plan.batchRecipeSlugs.length) {
    return [{ code: 'batch-size', message: 'Un plat est déclaré deux fois dans le batch.' }];
  }

  if (expectedBatchCount !== undefined && batchSlugs.size !== expectedBatchCount) {
    return [
      {
        code: 'batch-size',
        message: `Le batch compte ${batchSlugs.size} plats, il en faut exactement ${expectedBatchCount}.`,
      },
    ];
  }

  if (batchSlugs.size < MIN_BATCH_RECIPES || batchSlugs.size > MAX_BATCH_RECIPES) {
    return [
      {
        code: 'batch-size',
        message: `Le batch compte ${batchSlugs.size} plats, il en faut entre ${MIN_BATCH_RECIPES} et ${MAX_BATCH_RECIPES}.`,
      },
    ];
  }

  return [];
}

/**
 * Un plat du batch doit produire assez de portions pour tous les repas qui le
 * servent. Sans cette règle, le modèle déclare un curry de 4 portions mangé six
 * fois, et le foyer achète le tiers de ce qu'il faut.
 */
function servingsViolations(
  recipesBySlug: Map<string, GeneratedRecipe>,
  servedCount: Map<string, number>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const [slug, meals] of servedCount) {
    const recipe = recipesBySlug.get(slug);
    if (!recipe) continue;

    const needed = SERVINGS_PER_MEAL * meals;
    if (recipe.servings < needed) {
      violations.push({
        code: 'batch-servings-short',
        message: `« ${recipe.name} » sert ${meals} repas, soit ${needed} portions, mais n'en produit que ${recipe.servings}.`,
      });
    }
  }

  return violations;
}

/**
 * Cuisiné le dimanche, mangé le vendredi : cinq jours au frigo. L'étiquette
 * `congelable` est le seul signal dont on dispose sur la conservation, et
 * l'app s'en sert pour dire quand sortir le plat du congélateur.
 */
function freezableViolations(
  recipesBySlug: Map<string, GeneratedRecipe>,
  servedDays: Map<string, number[]>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const [slug, days] of servedDays) {
    const recipe = recipesBySlug.get(slug);
    if (!recipe || recipe.tags.includes('congelable')) continue;

    if (days.some(requiresFreezing)) {
      violations.push({
        code: 'batch-not-freezable',
        message: `« ${recipe.name} » est servi en fin de semaine : il doit porter l'étiquette « congelable ».`,
      });
    }
  }

  return violations;
}

/** Le plafond, dit une seule fois pour les deux chemins qui le vérifient. */
function batchTotalViolations(total: number): ConstraintViolation[] {
  if (total <= MAX_BATCH_TOTAL_MINUTES) return [];
  return [
    {
      code: 'batch-too-long',
      message: `Le batch demande ${total} minutes de préparation, le dimanche n'en offre que ${MAX_BATCH_TOTAL_MINUTES}.`,
    },
  ];
}

function batchDurationViolations(
  recipesBySlug: Map<string, GeneratedRecipe>,
  batchSlugs: Set<string>,
): ConstraintViolation[] {
  let total = 0;
  for (const slug of batchSlugs) {
    total += recipesBySlug.get(slug)?.prepMinutes ?? 0;
  }

  return batchTotalViolations(total);
}

/**
 * Contraintes d'un plat qu'on cuisine sans y passer la soirée : une casserole,
 * et moins de trois quarts d'heure.
 */
function quickMealViolations(recipe: GeneratedRecipe, label: string): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
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
  return violations;
}

/**
 * Contraintes applicables au remplacement d'un seul repas.
 *
 * Volontairement limitée à ce qui est local au jour visé. Les contraintes
 * d'ensemble — taille du batch, portions, congélation — portent sur la
 * composition de la semaine, décidée à la génération : les réappliquer ici
 * ferait refuser un remplacement parfaitement raisonnable. Voir CLAUDE.md §9
 * pour le point d'extension.
 *
 * C'est ici, et seulement ici, que la contrainte one-pot survit : remplacer un
 * repas oblige à cuisiner le jour même.
 *
 * Le `style` demandé prime sur le jour. Sans lui, la contrainte s'applique en
 * semaine et pas le week-end — ce qui reste le comportement par défaut.
 *
 * Le bannissement fait exception à la limitation au jour visé, et c'est
 * cohérent : il est local à la recette, pas à la composition de la semaine.
 */
export interface MealReplacementValidationOptions {
  style?: MealStyle | undefined;
  bannedNames?: readonly string[] | undefined;
}

export function validateMealReplacement(
  recipe: GeneratedRecipe,
  dayIndex: number,
  options: MealReplacementValidationOptions = {},
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  if (dayIndex < 0 || dayIndex > 6) {
    violations.push({
      code: 'day-index',
      message: `Le jour ${dayIndex} n'existe pas dans la semaine.`,
    });
    return violations;
  }

  violations.push(...bannedViolations(recipe, bannedIndex(options.bannedNames)));

  const mustBeQuick =
    options.style === undefined ? isWeekday(dayIndex) : options.style === 'one-pot';
  if (!mustBeQuick) return violations;

  violations.push(...quickMealViolations(recipe, `jour ${dayIndex}`));
  return violations;
}

export interface BatchReplacementContext {
  /** Nombre de repas que le plat remplacé servait — le nouveau doit les couvrir. */
  servedMeals: number;
  /** Index des jours servis, 0 = samedi : décide si la congélation est requise. */
  servedDayIndexes: readonly number[];
  /** Temps de préparation des autres plats du batch, qui restent en place. */
  otherBatchMinutes: number;
  bannedNames?: readonly string[] | undefined;
}

/**
 * Contraintes d'un plat qui prend la place d'un autre dans le batch.
 *
 * Contrairement à `validateMealReplacement`, qui ne regarde que le jour visé,
 * celles-ci portent sur la composition de la semaine — et il le faut, parce
 * qu'un plat du batch n'occupe pas un créneau mais plusieurs, et que
 * `buildGroceryList` ne l'achète **qu'une fois, aux portions déclarées**. Un
 * remplaçant qui en produit trop peu et le foyer sous-achète, sans un mot.
 */
export function validateBatchRecipeReplacement(
  recipe: GeneratedRecipe,
  context: BatchReplacementContext,
): ConstraintViolation[] {
  const bySlug = new Map([[recipe.slug, recipe]]);

  return [
    ...bannedViolations(recipe, bannedIndex(context.bannedNames)),
    ...servingsViolations(bySlug, new Map([[recipe.slug, context.servedMeals]])),
    ...freezableViolations(bySlug, new Map([[recipe.slug, [...context.servedDayIndexes]]])),
    ...batchTotalViolations(context.otherBatchMinutes + recipe.prepMinutes),
  ];
}

/** Rendu compact des violations, réinjecté dans le prompt lors du retry. */
export function describeViolations(violations: ConstraintViolation[]): string {
  return violations.map((violation) => `- ${violation.message}`).join('\n');
}
