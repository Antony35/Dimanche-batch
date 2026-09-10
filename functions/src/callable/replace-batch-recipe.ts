import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  MAX_BATCH_TOTAL_MINUTES,
  RecipeSchema,
  ReplaceBatchRecipeInputSchema,
  countMealsServing,
  getBatchSession,
  paths,
  requiresFreezing,
  type ReplaceBatchRecipeInput,
  type ReplaceBatchRecipeResult,
  type Recipe,
  type WeeklyPlan,
} from '@dimanche-batch/shared';
import {
  DEFAULT_MEMORY,
  DEFAULT_TIMEOUT_SECONDS,
  GEMINI_API_KEY,
  MAX_INSTANCES,
  REGION,
} from '../config';
import { db } from '../lib/firestore';
import { internal, invalidArgument, notFound, parseInput, unavailable } from '../lib/errors';
import {
  acquireGenerationLock,
  consumeGenerationQuota,
  refundGenerationQuota,
  releaseGenerationLock,
  reportGenerationStep,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import { PlanNotFoundError, readPlanForEdit, replaceBatchRecipe } from '../lib/plan-writer';
import { readBannedRecipeNames } from '../lib/recipe-memory';
import { GeminiUnavailableError } from '../gemini/client';
import {
  BatchRecipeGenerationError,
  generateBatchRecipeFromGemini,
} from '../gemini/replace-batch-recipe';

/**
 * Remplace un plat du batch, et avec lui tous les repas qu'il servait.
 *
 * Un plat du batch n'occupe pas un créneau mais plusieurs : le remplacer repas
 * par repas coûterait autant de générations qu'il sert de repas, et laisserait
 * la semaine incohérente entre deux appels. D'où une callable à part, et non un
 * paramètre de plus sur `regenerateMeal`.
 */
export const replaceBatchRecipeCallable = onCall(
  {
    region: REGION,
    memory: DEFAULT_MEMORY,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxInstances: MAX_INSTANCES,
    secrets: [GEMINI_API_KEY],
  },
  async (request): Promise<ReplaceBatchRecipeResult> => {
    logger.info('replaceBatchRecipe appelée', { authentifie: Boolean(request.auth) });

    const uid = requireAuth(request);
    const input: ReplaceBatchRecipeInput = parseInput(
      ReplaceBatchRecipeInputSchema,
      request.data,
      'replaceBatchRecipe',
    );

    await requireHouseholdMember(uid, input.householdId);

    const plan = await readPlanOrFail(input.householdId, input.weekId);
    if (!plan.batchRecipeIds.includes(input.recipeId)) {
      throw invalidArgument('Ce plat ne fait pas partie du batch de cette semaine.');
    }

    // Le verrou est celui de la semaine : ce remplacement réécrit le plan et
    // recalcule toute la liste de courses.
    await acquireGenerationLock(input.householdId, input.weekId, uid);
    try {
      return await swapBatchRecipe(input, plan);
    } finally {
      await releaseGenerationLock(input.householdId, input.weekId);
    }
  },
);

/** Corps du remplacement, une fois l'appel jugé légitime et le verrou posé. */
async function swapBatchRecipe(
  input: ReplaceBatchRecipeInput,
  plan: WeeklyPlan,
): Promise<ReplaceBatchRecipeResult> {
  await consumeGenerationQuota(input.householdId);

  const recipes = await readRecipes(input.householdId, plan.recipeIds);
  const session = getBatchSession(plan, recipes);
  const entry = session.recipes.find((candidate) => candidate.recipe.id === input.recipeId);
  const current = recipes.get(input.recipeId);

  if (!entry || !current) {
    // Le plat est bien dans `batchRecipeIds` mais son document a disparu :
    // rien de sensé à demander au modèle dans ce cas.
    throw notFound('La recette de ce plat est introuvable. Régénère la semaine.');
  }

  const servedMeals = countMealsServing(plan, input.recipeId);
  const otherBatchMinutes = session.recipes
    .filter((candidate) => candidate.recipe.id !== input.recipeId)
    .reduce((total, candidate) => total + candidate.recipe.prepMinutes, 0);

  if (otherBatchMinutes >= MAX_BATCH_TOTAL_MINUTES) {
    // Sans cette garde, on demanderait au modèle un plat de zéro minute.
    throw invalidArgument(
      'Les autres plats du batch occupent déjà tout l’après-midi : remplace-en un autre d’abord.',
    );
  }

  const bannedRecipeNames = await readBannedRecipeNames(input.householdId);
  const context = {
    servedMeals,
    servedDayIndexes: entry.servedDayIndexes,
    otherBatchMinutes,
    bannedRecipeNames,
  };

  let generated;
  try {
    generated = await generateBatchRecipeFromGemini(
      {
        currentRecipeName: current.name,
        servedMeals,
        needsFreezing: entry.servedDayIndexes.some(requiresFreezing),
        otherBatchMinutes,
        otherRecipeNames: [...recipes.values()]
          .filter((recipe) => recipe.id !== input.recipeId)
          .map((recipe) => recipe.name),
        bannedRecipeNames,
        notes: input.notes,
      },
      { ...context, bannedNames: bannedRecipeNames },
      (attempt) => {
        void reportGenerationStep(
          input.householdId,
          input.weekId,
          attempt === 1 ? 'generating' : 'retrying',
          attempt,
        );
      },
    );
  } catch (error) {
    // Aucun appel n'a abouti : la génération décomptée est rendue au foyer.
    if (error instanceof GeminiUnavailableError) {
      await refundGenerationQuota(input.householdId);
      throw unavailable(
        'Le service de génération est saturé en ce moment. Ta génération n’a pas été ' +
          'décomptée : réessaie dans une minute.',
        error,
      );
    }

    if (error instanceof BatchRecipeGenerationError) {
      logger.error('remplacement de plat abandonné', {
        violations: error.violations.map((violation) => violation.code),
      });
      throw internal(
        'Aucun plat proposé ne couvrait les repas de celui-ci, même après correction. ' +
          'Réessaie : le résultat varie d’une fois sur l’autre.',
        error,
      );
    }

    throw internal(
      'La recherche d’un plat a échoué pour une raison inattendue. Réessaie dans un instant.',
      error,
    );
  }

  await reportGenerationStep(input.householdId, input.weekId, 'writing', generated.attempts);

  try {
    const result = await replaceBatchRecipe({
      householdId: input.householdId,
      weekId: input.weekId,
      recipeId: input.recipeId,
      recipe: generated.recipe,
    });

    logger.info('plat du batch remplacé', {
      weekId: result.weekId,
      recette: result.recipeId,
      repas: result.mealCount,
      articles: result.itemCount,
      tentatives: generated.attempts,
    });

    return result;
  } catch (error) {
    if (error instanceof PlanNotFoundError) {
      throw invalidArgument(
        'Le plan de la semaine a changé pendant la génération, sans doute depuis l’autre ' +
          'téléphone. Rouvre le batch et réessaie.',
      );
    }
    throw internal(
      'Le plat a bien été trouvé mais n’a pas pu être enregistré. Réessaie dans un instant.',
      error,
    );
  }
}

/** Recettes du plan, indexées — le domaine en a besoin pour situer le batch. */
async function readRecipes(householdId: string, recipeIds: string[]): Promise<Map<string, Recipe>> {
  const snapshots = await Promise.all(
    [...new Set(recipeIds)].map((id) => db.doc(paths.recipe(householdId, id)).get()),
  );

  const recipes = new Map<string, Recipe>();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const parsed = RecipeSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
    if (parsed.success) recipes.set(parsed.data.id, parsed.data);
  }
  return recipes;
}

async function readPlanOrFail(householdId: string, weekId: string): Promise<WeeklyPlan> {
  try {
    return await readPlanForEdit(householdId, weekId);
  } catch (error) {
    if (error instanceof PlanNotFoundError) {
      throw notFound('Aucun plan pour cette semaine. Compose-la depuis l’accueil.');
    }
    throw error;
  }
}
