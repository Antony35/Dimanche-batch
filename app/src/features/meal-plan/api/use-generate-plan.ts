import { useMutation } from '@tanstack/react-query';
import type { GenerateWeeklyPlanInput } from '@dimanche-batch/shared';
import { generateWeeklyPlan } from '@/lib/callables';

/**
 * Lance la génération du plan.
 *
 * Aucun retry côté client : la function consomme le quota du foyer à chaque
 * appel, et elle gère déjà sa propre reprise en interne. Réessayer
 * automatiquement ici doublerait la dépense sans améliorer le résultat.
 *
 * Le plan écrit revient par le listener Firestore, il n'y a donc rien à
 * réinjecter dans le cache après succès.
 */
export function useGeneratePlan() {
  return useMutation({
    mutationFn: (input: GenerateWeeklyPlanInput) => generateWeeklyPlan(input),
    retry: 0,
  });
}
