import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query ne sert qu'aux appels ponctuels (callables, lectures uniques).
 * Les données synchronisées entre les deux téléphones passent par les listeners
 * temps réel de Firestore, qui poussent leurs mises à jour dans le cache : y
 * ajouter un refetch périodique ne ferait que consommer du quota.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
