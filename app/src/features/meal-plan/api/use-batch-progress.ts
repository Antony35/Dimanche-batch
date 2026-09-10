import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { cacheKeys, readCache, writeCache } from '@/lib/offline-cache';

/**
 * Une entrée par plat du batch.
 *
 * `stepCount` n'est pas décoratif : les étapes n'ont aucune identité stable —
 * ni identifiant, ni durée — leur seule adresse est l'index dans la recette. Si
 * le plat est remplacé, ses étapes changent et les index cochés ne veulent plus
 * rien dire. On compare donc le compte avant de restituer les cases, plutôt que
 * d'en afficher de fausses au milieu d'une session de cuisine.
 */
const RecipeProgressSchema = z.object({
  stepCount: z.number().int().min(0),
  checked: z.array(z.number().int().min(0)),
});

const BatchProgressSchema = z.record(z.string(), RecipeProgressSchema);

type BatchProgress = z.infer<typeof BatchProgressSchema>;

/** Référence stable : un objet neuf à chaque rendu invaliderait les mémos. */
const EMPTY: BatchProgress = {};

export interface BatchProgressState {
  /** Vrai si l'étape est cochée, et si la recette n'a pas changé depuis. */
  isChecked: (recipeId: string, stepIndex: number, stepCount: number) => boolean;
  toggleStep: (recipeId: string, stepIndex: number, stepCount: number) => void;
  /** Nombre d'étapes cochées d'un plat, pour l'afficher sur sa carte. */
  checkedCount: (recipeId: string, stepCount: number) => number;
}

/**
 * Où l'on en est dans la préparation du dimanche.
 *
 * Local au téléphone, à dessein : cocher une étape doit répondre à l'instant,
 * les mains occupées, et rien ici ne mérite un aller-retour Firestore. Si vous
 * cuisinez à deux avec deux téléphones, chacun suit son propre avancement.
 */
export function useBatchProgress(householdId: string | null, weekId: string): BatchProgressState {
  const key = householdId ? cacheKeys.batchProgress(householdId, weekId) : null;
  /** L'état porte sa clé : un avancement d'une autre semaine est périmé. */
  const [state, setState] = useState<{ key: string | null; progress: BatchProgress }>({
    key: null,
    progress: {},
  });

  // Hydratation depuis le disque : asynchrone par nature, donc écrite dans
  // l'état plutôt que dérivée au rendu (CLAUDE.md §7).
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void readCache(key, BatchProgressSchema).then((stored) => {
      if (!cancelled) setState({ key, progress: stored ?? {} });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Changer de semaine ne vide pas l'état dans un effet : on l'ignore tant
  // qu'il ne correspond pas à la clé courante.
  const progress = state.key === key ? state.progress : EMPTY;

  // Pas de mémoïsation : la lecture est un accès d'objet, et l'objet rendu par
  // ce hook est de toute façon neuf à chaque rendu.
  const entryFor = (recipeId: string, stepCount: number) => {
    const entry = progress[recipeId];
    return entry && entry.stepCount === stepCount ? entry : null;
  };

  const toggleStep = useCallback(
    (recipeId: string, stepIndex: number, stepCount: number): void => {
      if (!key) return;
      setState((previousState) => {
        const current = previousState.key === key ? previousState.progress : EMPTY;
        const previous = current[recipeId];
        // Un plat dont le nombre d'étapes a changé repart de zéro.
        const checked = previous?.stepCount === stepCount ? previous.checked : [];
        const next = checked.includes(stepIndex)
          ? checked.filter((index) => index !== stepIndex)
          : [...checked, stepIndex].sort((a, b) => a - b);

        const updated: BatchProgress = { ...current, [recipeId]: { stepCount, checked: next } };
        // L'écriture ne conditionne pas l'affichage : la case a déjà basculé.
        void writeCache(key, updated);
        return { key, progress: updated };
      });
    },
    [key],
  );

  return {
    isChecked: (recipeId, stepIndex, stepCount) =>
      entryFor(recipeId, stepCount)?.checked.includes(stepIndex) ?? false,
    checkedCount: (recipeId, stepCount) => entryFor(recipeId, stepCount)?.checked.length ?? 0,
    toggleStep,
  };
}
