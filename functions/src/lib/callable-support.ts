import type { WeeklyPlan } from '@dimanche-batch/shared';
import { GeminiUnavailableError } from '../gemini/client';
import { notFound, unavailable } from './errors';
import { refundGenerationQuota } from './guards';
import { PlanNotFoundError, readPlanForEdit } from './plan-writer';

/**
 * Ce que les callables de génération partagent, écrit une seule fois : elles
 * en portaient chacune une copie.
 */

const NO_PLAN = 'Aucun plan pour cette semaine. Compose-la depuis l’accueil.';

/**
 * Plan de la semaine, ou une erreur lisible par l'app. `readPlanForEdit` lève
 * une erreur technique ; chaque callable peut la traduire avec le message qui
 * convient à son geste.
 */
export async function readPlanOrFail(
  householdId: string,
  weekId: string,
  notFoundMessage = NO_PLAN,
): Promise<WeeklyPlan> {
  try {
    return await readPlanForEdit(householdId, weekId);
  } catch (error) {
    if (error instanceof PlanNotFoundError) throw notFound(notFoundMessage);
    throw error;
  }
}

/**
 * Si Gemini n'a rien pu produire, rend au foyer la génération décomptée et le
 * dit. Le quota protège la clé, pas le budget de l'utilisateur : une
 * saturation chez Google ne doit rien lui coûter. Sans effet sur toute autre
 * erreur, que l'appelant traduit lui-même.
 */
export async function rethrowIfUnavailable(error: unknown, householdId: string): Promise<void> {
  if (!(error instanceof GeminiUnavailableError)) return;
  await refundGenerationQuota(householdId);
  throw unavailable(
    'Le service de génération est saturé en ce moment. Ta génération n’a pas été ' +
      'décomptée : réessaie dans une minute.',
    error,
  );
}
