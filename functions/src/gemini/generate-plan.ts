import {
  GeneratedPlanSchema,
  validateGeneratedPlan,
  type ConstraintViolation,
  type GeneratedPlan,
} from '@dimanche-batch/shared';
import { SYSTEM_INSTRUCTION, buildPlanPrompt, type PlanPromptInput } from './prompt';
import { WEEKLY_PLAN_RESPONSE_SCHEMA } from './response-schema';
import { generateWithContentRetry } from './content-retry';

export interface GeneratedPlanResult {
  plan: GeneratedPlan;
  model: string;
  /** 1 si le premier jet convenait, 2 s'il a fallu la reprise. */
  attempts: number;
}

export class PlanGenerationError extends Error {
  constructor(
    message: string,
    readonly violations: ConstraintViolation[],
  ) {
    super(message);
    this.name = 'PlanGenerationError';
  }
}

/** Génère un plan valide, ou échoue clairement. Reprise : `content-retry.ts`. */
export async function generateWeeklyPlanFromGemini(
  input: PlanPromptInput,
  onAttempt?: (attempt: number) => void,
): Promise<GeneratedPlanResult> {
  const outcome = await generateWithContentRetry({
    subject: 'plan',
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: buildPlanPrompt(input),
    responseSchema: WEEKLY_PLAN_RESPONSE_SCHEMA,
    schema: GeneratedPlanSchema,
    validate: (plan) =>
      validateGeneratedPlan(plan, {
        expectedBatchCount: input.batchRecipeCount,
        bannedNames: input.bannedRecipeNames,
      }),
    describe: (plan) => ({ recettes: plan.recipes.length }),
    onAttempt,
  });

  if (!outcome.ok) {
    throw new PlanGenerationError(
      'Le plan proposé ne respecte pas les contraintes de la semaine, même après correction.',
      outcome.violations,
    );
  }
  return { plan: outcome.value, model: outcome.model, attempts: outcome.attempts };
}
