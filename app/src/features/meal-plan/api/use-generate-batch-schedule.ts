import { useMutation } from '@tanstack/react-query';
import type { GenerateBatchScheduleInput } from '@dimanche-batch/shared';
import { generateBatchSchedule } from '@/lib/callables';

/**
 * Compose le déroulé entrelacé du dimanche.
 *
 * Aucun retry, comme toute génération : chaque appel peut consommer le quota.
 * Le résultat revient par le listener de `useBatchSchedule`, sur les deux
 * téléphones à la fois.
 */
export function useGenerateBatchSchedule() {
  return useMutation({
    mutationFn: (input: GenerateBatchScheduleInput) => generateBatchSchedule(input),
    retry: 0,
  });
}
