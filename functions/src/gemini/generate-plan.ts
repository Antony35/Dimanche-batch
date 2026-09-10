import { logger } from 'firebase-functions';
import {
  GeneratedPlanSchema,
  validateGeneratedPlan,
  type ConstraintViolation,
  type GeneratedPlan,
} from '@dimanche-batch/shared';
import { SYSTEM_INSTRUCTION, buildPlanPrompt, buildRetryPrompt, type PlanPromptInput } from './prompt';
import { WEEKLY_PLAN_RESPONSE_SCHEMA } from './response-schema';
import { generateJson } from './client';

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

/**
 * Génère un plan valide, ou échoue clairement.
 *
 * Deux tentatives au maximum, jamais plus : la clé est partagée avec le quota
 * du foyer, et un modèle qui se trompe deux fois de suite sur des contraintes
 * aussi explicites ne se corrigera pas à la troisième. La reprise n'est pas
 * une répétition — elle renvoie au modèle la liste exacte de ses erreurs.
 */
export async function generateWeeklyPlanFromGemini(
  input: PlanPromptInput,
  /** Appelé avant chaque tentative, pour que l'app dise où en est la génération. */
  onAttempt?: (attempt: number) => void,
): Promise<GeneratedPlanResult> {
  const basePrompt = buildPlanPrompt(input);
  let prompt = basePrompt;
  let lastViolations: ConstraintViolation[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    onAttempt?.(attempt);

    const { data, model } = await generateJson({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      responseSchema: WEEKLY_PLAN_RESPONSE_SCHEMA,
    });

    const parsed = GeneratedPlanSchema.safeParse(data);
    if (!parsed.success) {
      // Le responseSchema n'a pas suffi : le modèle a respecté la forme mais
      // pas les bornes (une quantité négative, un slug hors motif…).
      lastViolations = parsed.error.issues.map((issue) => ({
        code: 'schema',
        message: `${issue.path.join('.') || 'racine'} : ${issue.message}`,
      }));
      logger.warn('plan refusé au schéma', { attempt, violations: lastViolations.length });
      prompt = buildRetryPrompt(basePrompt, lastViolations, data);
      continue;
    }

    const violations = validateGeneratedPlan(parsed.data, {
      expectedBatchCount: input.batchRecipeCount,
      bannedNames: input.bannedRecipeNames,
    });
    if (violations.length === 0) {
      logger.info('plan accepté', { attempt, model, recettes: parsed.data.recipes.length });
      return { plan: parsed.data, model, attempts: attempt };
    }

    lastViolations = violations;
    logger.warn('plan refusé aux contraintes', {
      attempt,
      codes: violations.map((violation) => violation.code),
    });
    prompt = buildRetryPrompt(basePrompt, violations, parsed.data);
  }

  throw new PlanGenerationError(
    'Le plan proposé ne respecte pas les contraintes de la semaine, même après correction.',
    lastViolations,
  );
}
