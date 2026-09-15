import {
  GeneratedCookingSessionSchema,
  validateCookingSession,
  type ConstraintViolation,
  type GeneratedCookingSession,
  type Recipe,
} from '@dimanche-batch/shared';
import {
  COOKING_SESSION_SYSTEM_INSTRUCTION,
  buildCookingSessionPrompt,
  type CookingSessionPromptInput,
} from './prompt';
import { COOKING_SESSION_RESPONSE_SCHEMA } from './response-schema';
import { generateWithContentRetry } from './content-retry';

export interface CookingSessionResult {
  session: GeneratedCookingSession;
  model: string;
  attempts: number;
}

export class CookingSessionGenerationError extends Error {
  constructor(
    message: string,
    readonly violations: ConstraintViolation[],
  ) {
    super(message);
    this.name = 'CookingSessionGenerationError';
  }
}

/**
 * Compose la session de cuisson, ou échoue clairement. Les fautes guettées : un
 * plat sans étape, une étape qui redemande de couper, une découpe pour un
 * ingrédient absent de la recette.
 */
export async function generateCookingSessionFromGemini(
  input: CookingSessionPromptInput,
  recipes: readonly Pick<Recipe, 'id' | 'name' | 'ingredients'>[],
  onAttempt?: (attempt: number) => void,
): Promise<CookingSessionResult> {
  const outcome = await generateWithContentRetry({
    subject: 'session de cuisson',
    systemInstruction: COOKING_SESSION_SYSTEM_INSTRUCTION,
    prompt: buildCookingSessionPrompt(input),
    responseSchema: COOKING_SESSION_RESPONSE_SCHEMA,
    // Réécrire n'appelle pas d'invention : on veut le même résultat deux fois.
    temperature: 0.3,
    schema: GeneratedCookingSessionSchema,
    validate: (session) => validateCookingSession(session, recipes),
    describe: (session) => ({ etapes: session.steps.length, decoupes: session.cuts.length }),
    onAttempt,
  });

  if (!outcome.ok) {
    throw new CookingSessionGenerationError(
      'Les étapes de cuisson proposées ne tenaient pas, même après correction.',
      outcome.violations,
    );
  }
  return { session: outcome.value, model: outcome.model, attempts: outcome.attempts };
}
