import {
  GeneratedBatchScheduleSchema,
  validateBatchSchedule,
  type ConstraintViolation,
  type GeneratedBatchSchedule,
} from '@dimanche-batch/shared';
import {
  BATCH_SCHEDULE_SYSTEM_INSTRUCTION,
  buildBatchSchedulePrompt,
  type BatchSchedulePromptInput,
} from './prompt';
import { BATCH_SCHEDULE_RESPONSE_SCHEMA } from './response-schema';
import { generateWithContentRetry } from './content-retry';

export interface BatchScheduleResult {
  schedule: GeneratedBatchSchedule;
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
 * Compose le déroulé entrelacé, ou échoue clairement. La faute la plus
 * probable est un plat oublié en route, précisément celle qu'on ne peut pas
 * laisser passer.
 */
export async function generateBatchScheduleFromGemini(
  input: BatchSchedulePromptInput,
  onAttempt?: (attempt: number) => void,
): Promise<BatchScheduleResult> {
  const batchRecipeIds = input.recipes.map((recipe) => recipe.id);
  const outcome = await generateWithContentRetry({
    subject: 'déroulé',
    systemInstruction: BATCH_SCHEDULE_SYSTEM_INSTRUCTION,
    prompt: buildBatchSchedulePrompt(input),
    responseSchema: BATCH_SCHEDULE_RESPONSE_SCHEMA,
    // Réordonner n'appelle pas d'invention : on veut le même déroulé deux fois.
    temperature: 0.3,
    schema: GeneratedBatchScheduleSchema,
    validate: (schedule) => validateBatchSchedule(schedule, batchRecipeIds),
    describe: (schedule) => ({ etapes: schedule.steps.length }),
    onAttempt,
  });

  if (!outcome.ok) {
    throw new BatchScheduleGenerationError(
      'Le déroulé proposé oubliait un plat, même après correction.',
      outcome.violations,
    );
  }
  return { schedule: outcome.value, model: outcome.model, attempts: outcome.attempts };
}
