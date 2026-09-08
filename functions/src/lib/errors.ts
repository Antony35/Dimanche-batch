import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

/**
 * Toute erreur remontée au client est un `HttpsError` porteur d'un message
 * lisible en français : l'app l'affiche telle quelle. Les détails techniques
 * partent dans les logs, jamais dans la réponse.
 */

export function invalidArgument(message: string, details?: unknown): HttpsError {
  if (details !== undefined) logger.warn('invalid-argument', { message, details });
  return new HttpsError('invalid-argument', message);
}

export function permissionDenied(message = "Tu n'as pas accès à ce foyer."): HttpsError {
  return new HttpsError('permission-denied', message);
}

export function notFound(message: string): HttpsError {
  return new HttpsError('not-found', message);
}

export function internal(message: string, cause?: unknown): HttpsError {
  logger.error('internal', { message, cause: serializeCause(cause) });
  return new HttpsError('internal', message);
}

export function resourceExhausted(message: string): HttpsError {
  return new HttpsError('resource-exhausted', message);
}

/**
 * Valide un payload client. Le message d'erreur Zod n'est jamais renvoyé tel
 * quel : il fuiterait la structure interne et serait illisible pour un humain.
 */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw invalidArgument(`Requête ${label} invalide.`, result.error.issues);
  }
  return result.data;
}

function serializeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}
