import { useEffect, useState } from 'react';
import { collection, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { z } from 'zod';
import { RecipeSchema, paths, type Recipe } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { subscribeWithRetry } from '@/lib/firestore-subscribe';
import { cacheKeys, readCache, writeCache } from '@/lib/offline-cache';

const CachedRecipesSchema = z.array(RecipeSchema);

/**
 * Toutes les recettes du foyer, indexées par identifiant.
 *
 * Le volume reste petit — quelques dizaines de documents après des mois
 * d'usage — donc un seul abonnement global coûte moins qu'une lecture par
 * repas affiché, et évite un effet de chargement en cascade sur le planning.
 */
export function useRecipes(householdId: string | null): {
  recipesById: Map<string, Recipe>;
  isLoading: boolean;
} {
  const [state, setState] = useState<{ key: string | null; recipes: Map<string, Recipe> }>({
    key: null,
    recipes: new Map(),
  });

  useEffect(() => {
    if (!householdId) return;

    const cacheKey = cacheKeys.recipes(householdId);
    let hasUsableData = false;

    // Sans les recettes en cache, le planning hors ligne n'afficherait que des
    // identifiants : le plan sait quoi servir, pas comment ça s'appelle.
    void readCache(cacheKey, CachedRecipesSchema).then((cached) => {
      if (!cached || hasUsableData) return;
      setState({ key: householdId, recipes: new Map(cached.map((r) => [r.id, r])) });
    });

    return subscribeWithRetry<QuerySnapshot>(
      (onNext, onError) => onSnapshot(collection(db, paths.recipes(householdId)), onNext, onError),
      (snapshot) => {
        // Un snapshot vide venu du cache mémoire n'est pas une réponse.
        hasUsableData = !snapshot.metadata.fromCache || snapshot.docs.length > 0;

        const recipes = new Map<string, Recipe>();
        for (const document of snapshot.docs) {
          const parsed = RecipeSchema.safeParse({ id: document.id, ...document.data() });
          if (parsed.success) recipes.set(parsed.data.id, parsed.data);
        }
        setState({ key: householdId, recipes });

        if (!snapshot.metadata.fromCache) void writeCache(cacheKey, [...recipes.values()]);
      },
      // Ce hook n'a pas de canal d'erreur vers l'écran : les recettes ne sont
      // qu'un dictionnaire de noms, et une carte sans nom se voit tout de
      // suite. On laisse au moins une trace plutôt que rien.
      (error) => console.warn('recettes : abonnement abandonné', error.code, error.message),
    );
  }, [householdId]);

  if (!householdId) return { recipesById: new Map(), isLoading: false };
  return { recipesById: state.recipes, isLoading: state.key !== householdId };
}
