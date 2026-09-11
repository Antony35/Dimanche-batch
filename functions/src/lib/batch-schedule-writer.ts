import {
  BatchScheduleSchema,
  paths,
  type BatchSchedule,
  type GeneratedBatchSchedule,
} from '@dimanche-batch/shared';
import { PROMPT_VERSION } from '../gemini/prompt';
import { db } from './firestore';

/** Déroulé enregistré pour la semaine, ou `null` s'il n'y en a pas de lisible. */
export async function readBatchSchedule(
  householdId: string,
  weekId: string,
): Promise<BatchSchedule | null> {
  const snapshot = await db.doc(paths.batchSchedule(householdId, weekId)).get();
  if (!snapshot.exists) return null;
  const parsed = BatchScheduleSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
  return parsed.success ? parsed.data : null;
}

export interface WriteBatchScheduleParams {
  householdId: string;
  weekId: string;
  sourceRecipeIds: string[];
  schedule: GeneratedBatchSchedule;
  generatedBy: string;
  model: string;
}

/**
 * Écrit le déroulé, typé par son schéma : un champ ajouté au schéma sans être
 * écrit ici devient une erreur de compilation, pas un document incomplet.
 */
export async function writeBatchSchedule(params: WriteBatchScheduleParams): Promise<void> {
  const document: Omit<BatchSchedule, 'id'> = {
    sourceRecipeIds: params.sourceRecipeIds,
    steps: params.schedule.steps,
    generatedAt: Date.now(),
    generatedBy: params.generatedBy,
    model: params.model,
    promptVersion: PROMPT_VERSION,
  };
  await db.doc(paths.batchSchedule(params.householdId, params.weekId)).set(document);
}
