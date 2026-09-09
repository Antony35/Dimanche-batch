import { z } from 'zod';

/**
 * Avancement d'une génération, tel que la Cloud Function le publie.
 *
 * **Rien d'autre qu'un code d'étape ne doit être écrit dans ce document.** Il
 * est lisible par les membres du foyer ; y déposer un message d'erreur brut ou
 * un extrait de la réponse du modèle exposerait de l'information technique par
 * un canal qui n'est pas fait pour ça. L'énumération garantit qu'aucune chaîne
 * arbitraire ne peut atteindre l'écran, et les libellés en français vivent dans
 * l'app, pas en base.
 */
export const GENERATION_STEPS = [
  /** Vérifications faites, on rassemble l'historique et les favoris. */
  'preparing',
  /** Le modèle compose — c'est ici que passe la quasi-totalité du temps. */
  'generating',
  /** La première proposition ne tenait pas les contraintes : unique reprise. */
  'retrying',
  /** Écriture du plan, des recettes et de la liste de courses. */
  'writing',
] as const;

export const GenerationStepSchema = z.enum(GENERATION_STEPS);

/**
 * Document `locks/{weekId}` : verrou et progression à la fois.
 *
 * Les deux rôles vont ensemble — une génération en cours est exactement ce qui
 * verrouille la semaine — et les réunir évite un second document, une seconde
 * règle et un second nettoyage.
 */
export const GenerationLockSchema = z.object({
  startedAt: z.number().int(),
  by: z.string().min(1),
  step: GenerationStepSchema,
  /** Numéro de tentative, 1 ou 2. Dit à l'utilisateur pourquoi c'est long. */
  attempt: z.number().int().min(1).max(2),
});

export type GenerationStep = z.infer<typeof GenerationStepSchema>;
export type GenerationLock = z.infer<typeof GenerationLockSchema>;
