import { logger } from 'firebase-functions';
import {
  GeneratedMealReplacementSchema,
  validateMealReplacement,
  type ConstraintViolation,
  type GeneratedRecipe,
} from '@dimanche-batch/shared';
import {
  MEAL_REPLACEMENT_SYSTEM_INSTRUCTION,
  buildMealReplacementPrompt,
  buildRetryPrompt,
  type MealReplacementPromptInput,
} from './prompt';
import { SINGLE_RECIPE_RESPONSE_SCHEMA } from './response-schema';
import { generateJson } from './client';

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
 * Produit la recette qui remplacera un repas, ou échoue clairement.
 *
 * Même politique que la génération complète : deux tentatives au maximum, et
 * la reprise renvoie au modèle la liste exacte de ses erreurs plutôt que la
 * même demande. Chaque appel consomme le quota du foyer — une boucle ici
 * coûterait autant qu'une semaine entière.
 */
export async function generateMealRecipeFromGemini(
  input: MealReplacementPromptInput,
): Promise<MealRecipeResult> {
  const basePrompt = buildMealReplacementPrompt(input);
  let prompt = basePrompt;
  let lastViolations: ConstraintViolation[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { data, model } = await generateJson({
      systemInstruction: MEAL_REPLACEMENT_SYSTEM_INSTRUCTION,
      prompt,
      responseSchema: SINGLE_RECIPE_RESPONSE_SCHEMA,
    });

    const parsed = GeneratedMealReplacementSchema.safeParse(data);
    if (!parsed.success) {
      lastViolations = parsed.error.issues.map((issue) => ({
        code: 'schema',
        message: `${issue.path.join('.') || 'racine'} : ${issue.message}`,
      }));
      logger.warn('recette refusée au schéma', { attempt, violations: lastViolations.length });
      prompt = buildRetryPrompt(basePrompt, lastViolations, data);
      continue;
    }

    const violations = validateMealReplacement(parsed.data.recipe, input.dayIndex);
    if (violations.length === 0) {
      logger.info('recette acceptée', { attempt, model, slug: parsed.data.recipe.slug });
      return { recipe: parsed.data.recipe, model, attempts: attempt };
    }

    lastViolations = violations;
    logger.warn('recette refusée aux contraintes', {
      attempt,
      codes: violations.map((violation) => violation.code),
    });
    prompt = buildRetryPrompt(basePrompt, violations, parsed.data);
  }

  throw new MealGenerationError(
    'La recette proposée ne convient pas à ce jour de la semaine, même après correction.',
    lastViolations,
  );
}
