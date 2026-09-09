import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  GenerateWeeklyPlanInputSchema,
  addDays,
  paths,
  type GenerateWeeklyPlanInput,
  type GenerateWeeklyPlanResult,
} from '@dimanche-batch/shared';
import {
  DEFAULT_MEMORY,
  DEFAULT_TIMEOUT_SECONDS,
  GEMINI_API_KEY,
  MAX_INSTANCES,
  REGION,
} from '../config';
import { db } from '../lib/firestore';
import { internal, invalidArgument, parseInput, unavailable } from '../lib/errors';
import {
  acquireGenerationLock,
  consumeGenerationQuota,
  refundGenerationQuota,
  releaseGenerationLock,
  reportGenerationStep,
  requireAuth,
  requireHouseholdMember,
} from '../lib/guards';
import { writeWeeklyPlan } from '../lib/plan-writer';
import { GeminiUnavailableError } from '../gemini/client';
import { PlanGenerationError, generateWeeklyPlanFromGemini } from '../gemini/generate-plan';

/** Nombre de semaines passées consultées pour éviter les répétitions. */
const HISTORY_WEEKS = 3;

/**
 * Génère le plan de la semaine.
 *
 * Ordre volontaire des étapes : on vérifie l'identité, puis l'appartenance au
 * foyer, puis l'existence d'un plan, et seulement ensuite on consomme le
 * quota. Décompter avant d'avoir écarté les appels illégitimes ferait payer à
 * l'utilisateur les erreurs des autres.
 */
export const generateWeeklyPlan = onCall(
  {
    region: REGION,
    memory: DEFAULT_MEMORY,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxInstances: MAX_INSTANCES,
    secrets: [GEMINI_API_KEY],
  },
  async (request): Promise<GenerateWeeklyPlanResult> => {
    // Trace d'entrée, avant tout garde-fou : sans elle, une requête rejetée
    // très tôt est indiscernable d'une requête qui n'est jamais arrivée.
    logger.info('generateWeeklyPlan appelée', { authentifie: Boolean(request.auth) });

    const uid = requireAuth(request);
    const input: GenerateWeeklyPlanInput = parseInput(
      GenerateWeeklyPlanInputSchema,
      request.data,
      'generateWeeklyPlan',
    );

    await requireHouseholdMember(uid, input.householdId);

    const planRef = db.doc(paths.weeklyPlan(input.householdId, input.weekStart));
    if (!input.force && (await planRef.get()).exists) {
      throw invalidArgument(
        'Un plan existe déjà pour cette semaine. Utilise la régénération pour le remplacer.',
      );
    }

    // Le verrou précède le quota : un appel concurrent ne doit rien coûter.
    await acquireGenerationLock(input.householdId, input.weekStart, uid);
    try {
      return await composePlan(input, uid);
    } finally {
      await releaseGenerationLock(input.householdId, input.weekStart);
    }
  },
);

/** Corps de la génération, une fois l'appel jugé légitime et le verrou posé. */
async function composePlan(
  input: GenerateWeeklyPlanInput,
  uid: string,
): Promise<GenerateWeeklyPlanResult> {
  await consumeGenerationQuota(input.householdId);

  const recentRecipeNames = await readRecentRecipeNames(input.householdId, input.weekStart);
  const favoriteRecipeNames = await readFavoriteRecipeNames(input.householdId, recentRecipeNames);

  let generated;
  try {
    generated = await generateWeeklyPlanFromGemini({
      weekStart: input.weekStart,
      batchRecipeCount: input.batchRecipeCount,
      recentRecipeNames,
      favoriteRecipeNames,
      notes: input.notes,
    });
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

    if (error instanceof PlanGenerationError) {
      logger.error('génération abandonnée', {
        violations: error.violations.map((violation) => violation.code),
      });
      throw internal(
        'La semaine proposée ne respectait pas tes contraintes, même après correction. ' +
          'Réessaie : le résultat varie d’une fois sur l’autre.',
        error,
      );
    }

    throw internal(
      'La génération de la semaine a échoué pour une raison inattendue. Réessaie dans un instant.',
      error,
    );
  }

  try {
    const result = await writeWeeklyPlan({
      householdId: input.householdId,
      weekStart: input.weekStart,
      generatedBy: uid,
      plan: generated.plan,
      model: generated.model,
    });

    logger.info('plan écrit', {
      weekId: result.weekId,
      recettes: result.recipeCount,
      articles: result.itemCount,
      tentatives: generated.attempts,
    });

    return result;
  } catch (error) {
    throw internal(
      'La semaine a bien été composée mais n’a pas pu être enregistrée. Réessaie dans un instant.',
      error,
    );
  }
}

/**
 * Noms des recettes servies lors des semaines précédentes.
 *
 * On lit les plans plutôt que la collection `recipes` : une recette peut
 * exister dans le foyer sans avoir été servie récemment, et c'est bien la
 * répétition rapprochée qu'on cherche à éviter, pas la réutilisation.
 */
async function readRecentRecipeNames(householdId: string, weekStart: string): Promise<string[]> {
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

/** Au-delà, la liste noierait le reste du prompt. */
const MAX_FAVORITES_IN_PROMPT = 8;

/**
 * Favoris du foyer, hors de ceux déjà servis récemment.
 *
 * Un favori mangé la semaine dernière n'a pas à revenir tout de suite : le
 * retirer ici évite de demander au modèle une chose et son contraire.
 */
async function readFavoriteRecipeNames(
  householdId: string,
  recentRecipeNames: string[],
): Promise<string[]> {
  const recent = new Set(recentRecipeNames);

  const snapshot = await db
    .collection(paths.recipes(householdId))
    .where('isFavorite', '==', true)
    .limit(MAX_FAVORITES_IN_PROMPT * 2)
    .get();

  return snapshot.docs
    .map((doc) => doc.get('name'))
    .filter((name): name is string => typeof name === 'string' && !recent.has(name))
    .slice(0, MAX_FAVORITES_IN_PROMPT);
}
