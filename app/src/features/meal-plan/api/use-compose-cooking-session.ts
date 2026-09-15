import { useMutation } from '@tanstack/react-query';
import type { ComposeCookingSessionInput } from '@dimanche-batch/shared';
import { composeCookingSession } from '@/lib/callables';

/**
 * Compose la session de cuisson du dimanche : découpes et étapes de cuisson.
 *
 * Aucun retry, comme toute génération : chaque appel peut consommer le quota.
 * Le résultat revient par le listener de `useCookingSession`, sur les deux
 * téléphones à la fois.
 */
export function useComposeCookingSession() {
  return useMutation({
    mutationFn: (input: ComposeCookingSessionInput) => composeCookingSession(input),
    retry: 0,
  });
}
