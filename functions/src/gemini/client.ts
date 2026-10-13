import { GoogleGenAI, type Schema } from '@google/genai';
import { logger } from 'firebase-functions';
import { GEMINI_API_KEY, GEMINI_BUDGET_MS, GEMINI_MODELS } from '../config';
import { callTimeoutMs, classifyCallFailure, hasTimeForAttempt } from './transport-errors';

/**
 * Client Gemini.
 *
 * La clé n'est lue qu'ici, au moment de l'appel, depuis le secret déclaré par
 * la function. Elle n'est jamais mise en cache dans une variable de module :
 * une rotation de secret prend effet au redéploiement sans laisser traîner
 * l'ancienne valeur dans une instance chaude.
 */

/**
 * Pourquoi Gemini n'a rien produit : `saturated` passe tout seul, `quota`
 * attend le lendemain, `billing` demande que quelqu'un recharge le crédit de
 * la clé.
 */
export type GeminiUnavailableReason = 'saturated' | 'quota' | 'billing' | 'invalid-key';

/**
 * Gemini n'a rien pu produire — aucun modèle de la chaîne n'a répondu, ou le
 * crédit de la clé est épuisé.
 *
 * Distincte des erreurs de contenu : aucun jeton n'a été consommé côté modèle,
 * donc l'appelant peut rendre au foyer la génération qu'il avait décomptée.
 */
export class GeminiUnavailableError extends Error {
  constructor(
    readonly attempts: number,
    readonly status: number | null,
    readonly reason: GeminiUnavailableReason = 'saturated',
    options?: { cause?: unknown },
  ) {
    super('Le service de génération est momentanément indisponible.', options);
    this.name = 'GeminiUnavailableError';
  }
}

export interface GenerateJsonOptions {
  systemInstruction: string;
  prompt: string;
  responseSchema: Schema;
  /** Basse par défaut : on veut un plan cohérent, pas une surprise. */
  temperature?: number;
  /**
   * Instant (ms epoch) au-delà duquel plus aucun appel ne doit courir. Partagé
   * par les deux tentatives d'une reprise de contenu ; à défaut, le budget
   * entier à partir de maintenant.
   */
  deadline?: number;
}

export interface GenerateJsonResult {
  /** JSON déjà désérialisé, mais pas encore validé. */
  data: unknown;
  /** Modèle qui a répondu, enregistré avec le plan. */
  model: string;
}

/**
 * Un appel par modèle de la chaîne, dans l'ordre, jusqu'à ce que l'un réponde.
 *
 * Ce n'est pas la « boucle de retry » que le projet s'interdit : celle-là
 * redemande une génération au modèle. Ici, le modèle précédent n'a rien
 * produit. Pas d'attente entre deux modèles : leurs saturations et leurs
 * quotas sont indépendants, attendre ne servirait qu'à user le budget.
 */
export async function generateJson(options: GenerateJsonOptions): Promise<GenerateJsonResult> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const deadline = options.deadline ?? Date.now() + GEMINI_BUDGET_MS;
  let allDailyQuota = true;
  let lastError: unknown = null;

  for (const [index, model] of GEMINI_MODELS.entries()) {
    const attempt = index + 1;
    const modelsAfter = GEMINI_MODELS.length - attempt;
    const msLeft = deadline - Date.now();
    if (!hasTimeForAttempt(msLeft)) {
      logger.error('gemini: plus le temps de tenter un appel', { model, attempt, msLeft });
      allDailyQuota = false;
      break;
    }

    // Le délai est porté par un signal à nous, pas par une option du SDK : on
    // sait ainsi qu'un échec vient de notre annulation, sans lire la forme de
    // ses erreurs.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), callTimeoutMs(msLeft, modelsAfter));
    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents: options.prompt,
        config: {
          systemInstruction: options.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: options.responseSchema,
          temperature: options.temperature ?? 0.7,
          abortSignal: controller.signal,
        },
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      const failure = classifyCallFailure(error, timedOut);
      const details = {
        model,
        attempt,
        timedOut,
        erreur: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };

      if (failure.kind === 'billing') {
        logger.error('gemini: crédit épuisé', details);
        throw new GeminiUnavailableError(attempt, 402, 'billing', { cause: error });
      }
      if (failure.kind === 'invalid-key') {
        logger.error('gemini: clé refusée', details);
        throw new GeminiUnavailableError(attempt, null, 'invalid-key', { cause: error });
      }
      if (failure.kind === 'fatal') {
        logger.error('gemini: appel refusé', details);
        throw error;
      }

      lastError = error;
      allDailyQuota &&= failure.dailyQuota;
      logger.warn('gemini: modèle indisponible, modèle suivant', {
        ...details,
        quotaDuJour: failure.dailyQuota,
        suivant: GEMINI_MODELS[attempt] ?? null,
      });
      continue;
    } finally {
      clearTimeout(timer);
    }

    const text = response.text;
    if (!text) {
      logger.error('gemini: réponse vide', {
        model,
        finishReason: response.candidates?.[0]?.finishReason,
      });
      throw new Error('Gemini a renvoyé une réponse vide.');
    }

    try {
      return { data: JSON.parse(text) as unknown, model };
    } catch {
      // Ne jamais logger `text` en entier : une réponse tronquée peut être longue.
      logger.error('gemini: JSON illisible', { model, extrait: text.slice(0, 200) });
      throw new Error('Gemini a renvoyé un JSON illisible.');
    }
  }

  // Aucun modèle n'a répondu. Le quota du jour n'est annoncé que s'il est la
  // cause de chaque échec : un seul modèle saturé suffit à ce que réessayer
  // dans une minute ait une chance.
  const reason = allDailyQuota ? 'quota' : 'saturated';
  logger.error('gemini: aucun modèle disponible', { modeles: GEMINI_MODELS, reason });
  throw new GeminiUnavailableError(GEMINI_MODELS.length, null, reason, { cause: lastError });
}
