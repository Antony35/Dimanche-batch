import { useEffect, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  HouseholdSchema,
  generateInviteCode,
  paths,
  type Household,
} from '@dimanche-batch/shared';
import { db } from '@/lib/firebase';
import { writeActiveHouseholdId } from '@/lib/storage';
import { useAuth } from '@/features/auth/auth-provider';

export interface HouseholdState {
  household: Household | null;
  isLoading: boolean;
  error: Error | null;
}

interface SnapshotState extends HouseholdState {
  /** Utilisateur auquel correspond l'état : sert à détecter un état périmé. */
  uid: string | null;
}

const INITIAL: SnapshotState = { uid: null, household: null, isLoading: true, error: null };

/**
 * Foyer de l'utilisateur courant, en temps réel.
 *
 * L'abonnement est une requête `array-contains` sur `members` : c'est
 * exactement ce que les Security Rules autorisent à lire, et c'est ce qui fait
 * apparaître le foyer sur le second téléphone dès que la callable
 * `joinHousehold` l'y a ajouté — sans rafraîchissement manuel.
 *
 * L'état de chargement est dérivé plutôt qu'écrit dans l'effet : tant que le
 * snapshot ne correspond pas à l'utilisateur courant, on est en chargement.
 * C'est ce qui évite un rendu en cascade au changement de compte.
 */
export function useHousehold(): HouseholdState {
  const { user } = useAuth();
  const [snapshotState, setSnapshotState] = useState<SnapshotState>(INITIAL);

  useEffect(() => {
    if (!user) return;

    const householdsQuery = query(
      collection(db, COLLECTIONS.households),
      where('members', 'array-contains', user.uid),
    );

    return onSnapshot(
      householdsQuery,
      (snapshot) => {
        const first = snapshot.docs[0];
        if (!first) {
          void writeActiveHouseholdId(null);
          setSnapshotState({ uid: user.uid, household: null, isLoading: false, error: null });
          return;
        }

        const parsed = HouseholdSchema.safeParse({ id: first.id, ...first.data() });
        if (!parsed.success) {
          setSnapshotState({
            uid: user.uid,
            household: null,
            isLoading: false,
            error: new Error('Les données du foyer sont illisibles.'),
          });
          return;
        }

        void writeActiveHouseholdId(parsed.data.id);
        setSnapshotState({
          uid: user.uid,
          household: parsed.data,
          isLoading: false,
          error: null,
        });
      },
      (error) => setSnapshotState({ uid: user.uid, household: null, isLoading: false, error }),
    );
  }, [user]);

  if (!user) return { household: null, isLoading: false, error: null };
  if (snapshotState.uid !== user.uid) return { household: null, isLoading: true, error: null };
  return {
    household: snapshotState.household,
    isLoading: snapshotState.isLoading,
    error: snapshotState.error,
  };
}

/**
 * Crée un foyer avec soi-même pour unique membre — le seul cas d'écriture
 * directe autorisé par les Security Rules sur `households`. Ajouter la seconde
 * personne passe ensuite par la callable `joinHousehold`.
 */
export async function createHousehold(uid: string, name: string): Promise<string> {
  const reference = await addDoc(collection(db, COLLECTIONS.households), {
    name: name.trim(),
    members: [uid],
    inviteCode: generateInviteCode(),
    createdAt: Date.now(),
    createdBy: uid,
  });
  return reference.id;
}

/** Régénère le code après usage : il est consommé dès qu'il a servi une fois. */
export async function refreshInviteCode(householdId: string): Promise<string> {
  const inviteCode = generateInviteCode();
  await updateDoc(doc(db, paths.household(householdId)), { inviteCode });
  return inviteCode;
}
