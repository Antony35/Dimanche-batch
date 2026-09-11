import {
  GeneratedMealReplacementSchema,
  validateMealReplacement,
  type ConstraintViolation,
  type GeneratedRecipe,
} from '@dimanche-batch/shared';
import {
  MEAL_REPLACEMENT_SYSTEM_INSTRUCTION,
  buildMealReplacementPrompt,
  type MealReplacementPromptInput,
} from './prompt';
import { SINGLE_RECIPE_RESPONSE_SCHEMA } from './response-schema';
import { generateWithContentRetry } from './content-retry';

export interface MealRecipeResult {
  recipe: GeneratedRecipe;
  model: string;
  /** 1 si le premier jet convenait, 2 s'il a fallu la reprise. */
  attempts: number;
}

export class MealGenerationError extends Error {
  constructor(
    message: string,
    readonly violations: ConstraintViolation[],
  ) {
    super(message);
    this.name = 'MealGenerationError';
  }
}

/**
 * Produit la recette qui remplacera un repas, ou échoue clairement. Chaque
 * appel consomme le quota du foyer : la reprise vit dans `content-retry.ts`,
 * bornée à deux tentatives.
 */
export async function generateMealRecipeFromGemini(
  input: MealReplacementPromptInput,
  onAttempt?: (attempt: number) => void,
): Promise<MealRecipeResult> {
  const outcome = await generateWithContentRetry({
    subject: 'recette',
    systemInstruction: MEAL_REPLACEMENT_SYSTEM_INSTRUCTION,
    prompt: buildMealReplacementPrompt(input),
    responseSchema: SINGLE_RECIPE_RESPONSE_SCHEMA,
    schema: GeneratedMealReplacementSchema,
    validate: ({ recipe }) =>
      validateMealReplacement(recipe, input.dayIndex, {
        style: input.style,
        bannedNames: input.bannedRecipeNames,
      }),
    describe: ({ recipe }) => ({ slug: recipe.slug }),
    onAttempt,
  });

  if (!outcome.ok) {
    throw new MealGenerationError(
      'La recette proposée ne convient pas à ce jour de la semaine, même après correction.',
      outcome.violations,
    );
  }
  return { recipe: outcome.value.recipe, model: outcome.model, attempts: outcome.attempts };
}
