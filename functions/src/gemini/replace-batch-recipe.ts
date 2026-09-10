import { logger } from 'firebase-functions';
import {
  GeneratedMealReplacementSchema,
  validateBatchRecipeReplacement,
  type BatchReplacementContext,
  type ConstraintViolation,
  type GeneratedRecipe,
} from '@dimanche-batch/shared';
import {
  BATCH_RECIPE_SYSTEM_INSTRUCTION,
  buildBatchRecipePrompt,
  buildRetryPrompt,
  type BatchRecipePromptInput,
} from './prompt';
import { SINGLE_RECIPE_RESPONSE_SCHEMA } from './response-schema';
import { generateJson } from './client';

export interface BatchRecipeResult {
  recipe: GeneratedRecipe;
  model: string;
  /** 1 si le premier jet convenait, 2 s'il a fallu la reprise. */
  attempts: number;
}

export class BatchRecipeGenerationError extends Error {
  constructor(
    message: string,
    readonly violations: ConstraintViolation[],
  ) {
    super(message);
    this.name = 'BatchRecipeGenerationError';
  }
}

/**
 * Produit le plat qui prendra la place d'un autre dans le batch.
 *
 * Même politique que partout ailleurs : deux tentatives au maximum, et la
 * reprise renvoie au modèle la liste exacte de ses erreurs. Les contraintes
 * sont ici plus dures que pour un repas isolé — portions pour N repas,
 * congélation, temps restant dans l'après-midi — donc la reprise sert plus
 * souvent, et le prompt les énonce toutes pour la rendre rare.
 */
export async function generateBatchRecipeFromGemini(
  input: BatchRecipePromptInput,
  context: BatchReplacementContext,
  /** Appelé avant chaque tentative, pour que l'app dise où en est la recherche. */
  onAttempt?: (attempt: number) => void,
): Promise<BatchRecipeResult> {
  const basePrompt = buildBatchRecipePrompt(input);
  let prompt = basePrompt;
  let lastViolations: ConstraintViolation[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    onAttempt?.(attempt);

    const { data, model } = await generateJson({
      systemInstruction: BATCH_RECIPE_SYSTEM_INSTRUCTION,
      prompt,
      responseSchema: SINGLE_RECIPE_RESPONSE_SCHEMA,
    });

    const parsed = GeneratedMealReplacementSchema.safeParse(data);
    if (!parsed.success) {
      lastViolations = parsed.error.issues.map((issue) => ({
        code: 'schema',
        message: `${issue.path.join('.') || 'racine'} : ${issue.message}`,
      }));
      logger.warn('plat de batch refusé au schéma', { attempt, violations: lastViolations.length });
      prompt = buildRetryPrompt(basePrompt, lastViolations, data);
      continue;
    }

    const violations = validateBatchRecipeReplacement(parsed.data.recipe, context);
    if (violations.length === 0) {
      logger.info('plat de batch accepté', { attempt, model, slug: parsed.data.recipe.slug });
      return { recipe: parsed.data.recipe, model, attempts: attempt };
    }

    lastViolations = violations;
    logger.warn('plat de batch refusé aux contraintes', {
      attempt,
      codes: violations.map((violation) => violation.code),
    });
    prompt = buildRetryPrompt(basePrompt, violations, parsed.data);
  }

  throw new BatchRecipeGenerationError(
    'Aucun plat proposé ne couvrait les repas de celui qu’il remplace, même après correction.',
    lastViolations,
  );
}
