import { GoogleGenAI, type Schema } from '@google/genai';
import { logger } from 'firebase-functions';
import { GEMINI_API_KEY, GEMINI_MODEL } from '../config';

/**
 * Client Gemini.
 *
 * La clé n'est lue qu'ici, au moment de l'appel, depuis le secret déclaré par
 * la function. Elle n'est jamais mise en cache dans une variable de module :
 * une rotation de secret prend effet au redéploiement sans laisser traîner
 * l'ancienne valeur dans une instance chaude.
 */

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
    logger.error('gemini: appel refusé', {
      model,
      erreur: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    throw error;
  }

  const text = response.text;
  if (!text) {
    logger.error('gemini: réponse vide', { model, finishReason: response.candidates?.[0]?.finishReason });
    throw new Error('Gemini a renvoyé une réponse vide.');
  }

  try {
    return { data: JSON.parse(text) as unknown, model };
  } catch (error) {
    // Ne jamais logger `text` en entier : une réponse tronquée peut être longue.
    logger.error('gemini: JSON illisible', { model, extrait: text.slice(0, 200) });
    throw new Error('Gemini a renvoyé un JSON illisible.');
  }
}
