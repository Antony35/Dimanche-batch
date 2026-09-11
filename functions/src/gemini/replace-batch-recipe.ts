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
  type BatchRecipePromptInput,
} from './prompt';
import { SINGLE_RECIPE_RESPONSE_SCHEMA } from './response-schema';
import { generateWithContentRetry } from './content-retry';

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
 * Produit le plat qui prendra la place d'un autre dans le batch. Les
 * contraintes y sont plus dures que pour un repas isolé — portions pour N
 * repas, congélation, temps restant — donc le prompt les énonce toutes pour
 * rendre la reprise rare.
 */
export async function generateBatchRecipeFromGemini(
  input: BatchRecipePromptInput,
  context: BatchReplacementContext,
  onAttempt?: (attempt: number) => void,
): Promise<BatchRecipeResult> {
  const outcome = await generateWithContentRetry({
    subject: 'plat de batch',
    systemInstruction: BATCH_RECIPE_SYSTEM_INSTRUCTION,
    prompt: buildBatchRecipePrompt(input),
    responseSchema: SINGLE_RECIPE_RESPONSE_SCHEMA,
    schema: GeneratedMealReplacementSchema,
    validate: ({ recipe }) => validateBatchRecipeReplacement(recipe, context),
    describe: ({ recipe }) => ({ slug: recipe.slug }),
    onAttempt,
  });

  if (!outcome.ok) {
    throw new BatchRecipeGenerationError(
      'Aucun plat proposé ne couvrait les repas de celui qu’il remplace, même après correction.',
      outcome.violations,
    );
  }
  return { recipe: outcome.value.recipe, model: outcome.model, attempts: outcome.attempts };
}
