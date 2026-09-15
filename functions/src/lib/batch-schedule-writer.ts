import {
  CookingSessionSchema,
  paths,
  type CookingSession,
  type GeneratedCookingSession,
} from '@dimanche-batch/shared';
import { PROMPT_VERSION } from '../gemini/prompt';
import { db } from './firestore';

/** Session de cuisson enregistrée pour la semaine, ou `null` s'il n'y en a pas de lisible. */
export async function readCookingSession(
  householdId: string,
  weekId: string,
): Promise<CookingSession | null> {
  const snapshot = await db.doc(paths.batchSession(householdId, weekId)).get();
  if (!snapshot.exists) return null;
  const parsed = CookingSessionSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
  return parsed.success ? parsed.data : null;
}

export interface WriteCookingSessionParams {
  householdId: string;
  weekId: string;
  sourceRecipeIds: string[];
  session: GeneratedCookingSession;
  generatedBy: string;
  model: string;
}

/**
 * Écrit la session, typée par son schéma : un champ ajouté au schéma sans être
 * écrit ici devient une erreur de compilation, pas un document incomplet.
 */
export async function writeCookingSession(params: WriteCookingSessionParams): Promise<void> {
  const document: Omit<CookingSession, 'id'> = {
    sourceRecipeIds: params.sourceRecipeIds,
    cuts: params.session.cuts,
    steps: params.session.steps,
    timings: params.session.timings,
    generatedAt: Date.now(),
    generatedBy: params.generatedBy,
    model: params.model,
    promptVersion: PROMPT_VERSION,
  };
  await db.doc(paths.batchSession(params.householdId, params.weekId)).set(document);
}
