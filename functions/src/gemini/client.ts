import { GoogleGenAI, type Schema } from '@google/genai';
import { logger } from 'firebase-functions';
import { GEMINI_API_KEY, GEMINI_MODEL } from '../config';
import { httpStatusOf, isRetryableStatus } from './transport-errors';

/**
 * Client Gemini.
 *
 * La clé n'est lue qu'ici, au moment de l'appel, depuis le secret déclaré par
 * la function. Elle n'est jamais mise en cache dans une variable de module :
 * une rotation de secret prend effet au redéploiement sans laisser traîner
 * l'ancienne valeur dans une instance chaude.
 */

/** Trois essais au plus, séparés par une attente croissante. */
const TRANSPORT_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 3_000];

/**
 * Gemini n'a rien pu produire — surcharge, panne, coupure réseau.
 *
 * Distincte des erreurs de contenu : aucun jeton n'a été consommé côté modèle,
 * donc l'appelant peut rendre au foyer la génération qu'il avait décomptée.
 */
export class GeminiUnavailableError extends Error {
  constructor(
    readonly attempts: number,
    readonly status: number | null,
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
}

export interface GenerateJsonResult {
  /** JSON déjà désérialisé, mais pas encore validé. */
  data: unknown;
  model: string;
}

export async function generateJson(options: GenerateJsonOptions): Promise<GenerateJsonResult> {
  const model = GEMINI_MODEL;
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt += 1) {
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
        },
      });
    } catch (error) {
      const status = httpStatusOf(error);

      // Une reprise ici n'est pas la « boucle de retry » que le projet
      // s'interdit : celle-là redemande une génération au modèle. Ici rien
      // n'a été produit — c'est le transport qui a lâché.
      if (isRetryableStatus(status) && attempt < TRANSPORT_ATTEMPTS) {
        const delay = BACKOFF_MS[attempt - 1] ?? 3_000;
        logger.warn('gemini: indisponible, nouvelle tentative', { model, status, attempt, delay });
        await wait(delay);
        continue;
      }

      logger.error('gemini: appel refusé', {
        model,
        status,
        attempt,
        erreur: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });

      if (isRetryableStatus(status)) {
        throw new GeminiUnavailableError(attempt, status, { cause: error });
      }
      throw error;
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

  // Inatteignable : la boucle sort par `return` ou par `throw`.
  throw new GeminiUnavailableError(TRANSPORT_ATTEMPTS, null);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
