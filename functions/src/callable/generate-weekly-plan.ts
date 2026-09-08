import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  GenerateWeeklyPlanInputSchema,
  addDays,
  paths,
  type GenerateWeeklyPlanInput,
} from '@dimanche-batch/shared';
import {
  DEFAULT_MEMORY,
  DEFAULT_TIMEOUT_SECONDS,
  GEMINI_API_KEY,
  MAX_INSTANCES,
  REGION,
} from '../config';
import { db } from '../lib/firestore';
import { internal, invalidArgument, parseInput } from '../lib/errors';
import { consumeGenerationQuota, requireAuth, requireHouseholdMember } from '../lib/guards';
import { writeWeeklyPlan } from '../lib/plan-writer';
import { PlanGenerationError, generateWeeklyPlanFromGemini } from '../gemini/generate-plan';

/** Nombre de semaines passées consultées pour éviter les répétitions. */
const HISTORY_WEEKS = 3;

export interface GenerateWeeklyPlanResult {
  weekId: string;
  recipeCount: number;
  itemCount: number;
}

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

    await consumeGenerationQuota(input.householdId);

    const recentRecipeNames = await readRecentRecipeNames(input.householdId, input.weekStart);

    let generated;
    try {
      generated = await generateWeeklyPlanFromGemini({
        weekStart: input.weekStart,
        recentRecipeNames,
        notes: input.notes,
      });
    } catch (error) {
      if (error instanceof PlanGenerationError) {
        logger.error('génération abandonnée', {
          violations: error.violations.map((violation) => violation.code),
        });
        throw internal(
          'Impossible de composer une semaine cohérente pour le moment. Réessaie dans un instant.',
          error,
        );
      }
      throw internal('La génération du plan a échoué.', error);
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
      throw internal("Le plan a été généré mais n'a pas pu être enregistré.", error);
    }
  },
);

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
