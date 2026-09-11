import type { Schema } from '@google/genai';
import { logger } from 'firebase-functions';
import type { z } from 'zod';
import type { ConstraintViolation } from '@dimanche-batch/shared';
import { generateJson } from './client';
import { buildRetryPrompt } from './prompt';

/**
 * La reprise de contenu, écrite une seule fois.
 *
 * Deux tentatives au maximum, jamais plus : la clé est partagée avec le quota
 * du foyer, et un modèle qui se trompe deux fois sur des contraintes aussi
 * explicites ne se corrigera pas à la troisième. La reprise n'est pas une
 * répétition — elle renvoie au modèle la liste exacte de ses erreurs.
 *
 * Les quatre chaînes de génération — semaine, repas, plat du batch, déroulé —
 * ne diffèrent que par leur schéma et leur validateur. Elles portaient chacune
 * une copie de cette boucle ; une politique de reprise écrite quatre fois
 * finit par en être quatre.
 */
const MAX_ATTEMPTS = 2;

export interface ContentRetryRequest<T> {
  /** Ce qui est généré, pour les logs : « plan », « recette »… */
  subject: string;
  systemInstruction: string;
  prompt: string;
  responseSchema: Schema;
  temperature?: number | undefined;
  schema: z.ZodType<T>;
  validate: (value: T) => ConstraintViolation[];
  /** Champs ajoutés au log d'acceptation. */
  describe?: ((value: T) => Record<string, unknown>) | undefined;
  /** Appelé avant chaque tentative, pour que l'app dise où en est la génération. */
  onAttempt?: ((attempt: number) => void) | undefined;
}

export type ContentRetryOutcome<T> =
  | { ok: true; value: T; model: string; attempts: number }
  | { ok: false; violations: ConstraintViolation[] };

export async function generateWithContentRetry<T>(
  request: ContentRetryRequest<T>,
): Promise<ContentRetryOutcome<T>> {
  let prompt = request.prompt;
  let lastViolations: ConstraintViolation[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    request.onAttempt?.(attempt);

    const { data, model } = await generateJson({
      systemInstruction: request.systemInstruction,
      prompt,
      responseSchema: request.responseSchema,
      temperature: request.temperature,
    });

    const parsed = request.schema.safeParse(data);
    if (!parsed.success) {
      // Le responseSchema n'a pas suffi : le modèle a respecté la forme mais
      // pas les bornes (une quantité négative, un slug hors motif…).
      lastViolations = parsed.error.issues.map((issue) => ({
        code: 'schema',
        message: `${issue.path.join('.') || 'racine'} : ${issue.message}`,
      }));
      logger.warn('génération refusée au schéma', {
        sujet: request.subject,
        attempt,
        violations: lastViolations.length,
      });
      prompt = buildRetryPrompt(request.prompt, lastViolations, data);
      continue;
    }

    const violations = request.validate(parsed.data);
    if (violations.length === 0) {
      logger.info('génération acceptée', {
        sujet: request.subject,
        attempt,
        model,
        ...request.describe?.(parsed.data),
      });
      return { ok: true, value: parsed.data, model, attempts: attempt };
    }

    lastViolations = violations;
    logger.warn('génération refusée aux contraintes', {
      sujet: request.subject,
      attempt,
      codes: violations.map((violation) => violation.code),
    });
    prompt = buildRetryPrompt(request.prompt, violations, parsed.data);
  }

  return { ok: false, violations: lastViolations };
}
