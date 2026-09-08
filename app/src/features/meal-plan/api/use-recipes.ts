import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { RecipeSchema, paths, type Recipe } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

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

    return onSnapshot(collection(db, paths.recipes(householdId)), (snapshot) => {
      const recipes = new Map<string, Recipe>();
      for (const document of snapshot.docs) {
        const parsed = RecipeSchema.safeParse({ id: document.id, ...document.data() });
        if (parsed.success) recipes.set(parsed.data.id, parsed.data);
      }
      setState({ key: householdId, recipes });
    });
  }, [householdId]);

  if (!householdId) return { recipesById: new Map(), isLoading: false };
  return { recipesById: state.recipes, isLoading: state.key !== householdId };
}
