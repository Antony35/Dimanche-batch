import { httpsCallable, type HttpsCallableResult } from 'firebase/functions';
import { FirebaseError } from 'firebase/app';
import {
  JoinHouseholdResultSchema,
  type JoinHouseholdInput,
  type JoinHouseholdResult,
} from '@dimanche-batch/shared';
import type { z } from 'zod';
import { functions } from './firebase';

/**
 * Un seul point d'appel des Cloud Functions, typé et validé.
 *
 * La réponse d'une callable est du `unknown` du point de vue du client : la
 * passer par son schéma évite qu'un changement de contrat côté serveur ne se
 * manifeste que par un crash d'affichage trois écrans plus loin.
 */
async function call<TInput, TOutput>(
  name: string,
  schema: z.ZodType<TOutput>,
  input: TInput,
): Promise<TOutput> {
  let result: HttpsCallableResult<unknown>;
  try {
    result = await httpsCallable<TInput, unknown>(functions, name)(input);
  } catch (error) {
    throw toReadableError(error);
  }

  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw new Error(`Réponse inattendue de ${name}. Mets l'application à jour.`);
  }
  return parsed.data;
}

/** Les `HttpsError` du serveur portent déjà un message en français. */
function toReadableError(error: unknown): Error {
  if (error instanceof FirebaseError) {
    return new Error(error.message || 'Le serveur est indisponible, réessaie dans un instant.');
  }
  if (error instanceof Error) return error;
  return new Error('Une erreur inattendue est survenue.');
}

export function joinHousehold(input: JoinHouseholdInput): Promise<JoinHouseholdResult> {
  return call('joinHousehold', JoinHouseholdResultSchema, input);
}
