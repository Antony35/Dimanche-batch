import {
  GeneratedCookingSessionSchema,
  validateBatchSession,
  type ConstraintViolation,
  type GeneratedCookingSession,
  type Recipe,
} from '@dimanche-batch/shared';
import {
  BATCH_SCHEDULE_SYSTEM_INSTRUCTION,
  buildBatchSchedulePrompt,
  type BatchSchedulePromptInput,
} from './prompt';
import { BATCH_SCHEDULE_RESPONSE_SCHEMA } from './response-schema';
import { generateWithContentRetry } from './content-retry';

export interface BatchScheduleResult {
  session: GeneratedCookingSession;
  model: string;
  attempts: number;
}

export class BatchScheduleGenerationError extends Error {
  constructor(
    message: string,
    readonly violations: ConstraintViolation[],
  ) {
    super(message);
    this.name = 'BatchScheduleGenerationError';
  }
}

/**
 * Compose la session de cuisson, ou échoue clairement. Les fautes guettées : un
 * plat sans étape, une étape qui redemande de couper, une découpe pour un
 * ingrédient absent de la recette.
 */
export async function generateBatchScheduleFromGemini(
  input: BatchSchedulePromptInput,
  recipes: readonly Pick<Recipe, 'id' | 'name' | 'ingredients'>[],
  onAttempt?: (attempt: number) => void,
): Promise<BatchScheduleResult> {
  const outcome = await generateWithContentRetry({
    subject: 'session de cuisson',
    systemInstruction: BATCH_SCHEDULE_SYSTEM_INSTRUCTION,
    prompt: buildBatchSchedulePrompt(input),
    responseSchema: BATCH_SCHEDULE_RESPONSE_SCHEMA,
    // Réécrire n'appelle pas d'invention : on veut le même résultat deux fois.
    temperature: 0.3,
    schema: GeneratedCookingSessionSchema,
    validate: (session) => validateBatchSession(session, recipes),
    describe: (session) => ({ etapes: session.steps.length, decoupes: session.cuts.length }),
    onAttempt,
  });

  if (!outcome.ok) {
    throw new BatchScheduleGenerationError(
      'Les étapes de cuisson proposées ne tenaient pas, même après correction.',
      outcome.violations,
    );
  }
  return { session: outcome.value, model: outcome.model, attempts: outcome.attempts };
}
