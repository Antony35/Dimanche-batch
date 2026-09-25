import { useMutation } from '@tanstack/react-query';
import { doc, setDoc } from 'firebase/firestore';
import { aisleOverrideKey, paths, type Aisle } from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';

export interface SaveAisleCorrectionInput {
  householdId: string;
  name: string;
  aisle: Aisle;
}

/**
 * Enregistre le rayon que le foyer a choisi pour un article.
 *
 * Écriture cliente bornée par la règle du lexique : un seul document,
 * une seule clé, et des rayons connus. Écrite en fusion, jamais en
 * remplacement : deux téléphones qui corrigent chacun un article en même temps
 * ne s'effacent pas l'un l'autre.
 */
export function useSaveAisleCorrection() {
  return useMutation({
    mutationFn: async ({ householdId, name, aisle }: SaveAisleCorrectionInput) => {
      await setDoc(
        doc(db, paths.aisleLexicon(householdId)),
        { entries: { [aisleOverrideKey(name)]: aisle } },
        { merge: true },
      );
    },
    retry: 0,
  });
}
