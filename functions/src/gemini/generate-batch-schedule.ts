import { logger } from 'firebase-functions';
import {
  GeneratedBatchScheduleSchema,
  validateBatchSchedule,
  type ConstraintViolation,
  type GeneratedBatchSchedule,
} from '@dimanche-batch/shared';
import {
  BATCH_SCHEDULE_SYSTEM_INSTRUCTION,
  buildBatchSchedulePrompt,
  buildRetryPrompt,
  type BatchSchedulePromptInput,
} from './prompt';
import { BATCH_SCHEDULE_RESPONSE_SCHEMA } from './response-schema';
import { generateJson } from './client';

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
 * Compose le déroulé entrelacé, ou échoue clairement.
 *
 * Même politique que partout : deux tentatives au plus, la reprise renvoyant au
 * modèle la liste exacte de ses erreurs. La plus probable ici est un plat oublié
 * en route, et c'est précisément celle qu'on ne peut pas laisser passer.
 */
export async function generateBatchScheduleFromGemini(
  input: BatchSchedulePromptInput,
  onAttempt?: (attempt: number) => void,
): Promise<BatchScheduleResult> {
  const batchRecipeIds = input.recipes.map((recipe) => recipe.id);
  const basePrompt = buildBatchSchedulePrompt(input);
  let prompt = basePrompt;
  let lastViolations: ConstraintViolation[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    onAttempt?.(attempt);

    const { data, model } = await generateJson({
      systemInstruction: BATCH_SCHEDULE_SYSTEM_INSTRUCTION,
      prompt,
      responseSchema: BATCH_SCHEDULE_RESPONSE_SCHEMA,
      // Réordonner n'appelle pas d'invention : on veut le même déroulé deux fois.
      temperature: 0.3,
    });

    const parsed = GeneratedBatchScheduleSchema.safeParse(data);
    if (!parsed.success) {
      lastViolations = parsed.error.issues.map((issue) => ({
        code: 'schema',
        message: `${issue.path.join('.') || 'racine'} : ${issue.message}`,
      }));
      logger.warn('déroulé refusé au schéma', { attempt, violations: lastViolations.length });
      prompt = buildRetryPrompt(basePrompt, lastViolations, data);
      continue;
    }

    const violations = validateBatchSchedule(parsed.data, batchRecipeIds);
    if (violations.length === 0) {
      logger.info('déroulé accepté', { attempt, model, etapes: parsed.data.steps.length });
      return { schedule: parsed.data, model, attempts: attempt };
    }

    lastViolations = violations;
    logger.warn('déroulé refusé aux contraintes', {
      attempt,
      codes: violations.map((violation) => violation.code),
    });
    prompt = buildRetryPrompt(basePrompt, violations, parsed.data);
  }

  throw new BatchScheduleGenerationError(
    'Le déroulé proposé oubliait un plat, même après correction.',
    lastViolations,
  );
}
