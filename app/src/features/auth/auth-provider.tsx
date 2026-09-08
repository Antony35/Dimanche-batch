import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from '@firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth } from '@/lib/firebase';

export interface AuthState {
  user: User | null;
  /** Vrai tant que Firebase n'a pas restauré la session persistée. */
  isInitializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // Un seul listener pour toute l'app : c'est lui qui fait autorité sur la
    // session, y compris après un redémarrage (persistance AsyncStorage).
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setIsInitializing(false);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isInitializing,
      signIn: async (email, password) => {
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
        } catch (error) {
          throw toAuthError(error);
        }
      },
      signUp: async (email, password, displayName) => {
        try {
          const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
          await updateProfile(credential.user, { displayName: displayName.trim() });
        } catch (error) {
          throw toAuthError(error);
        }
      },
      signOut: () => firebaseSignOut(auth),
    }),
    [user, isInitializing],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un AuthProvider.');
  return context;
}

/** Traduit les codes Firebase en messages affichables tels quels. */
function toAuthError(error: unknown): Error {
  if (!(error instanceof FirebaseError)) {
    return error instanceof Error ? error : new Error('Connexion impossible.');
  }

  const messages: Record<string, string> = {
    'auth/invalid-email': "Cette adresse e-mail n'est pas valide.",
    'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
    'auth/wrong-password': 'E-mail ou mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte ne correspond à cette adresse.',
    'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse.',
    'auth/weak-password': 'Le mot de passe doit faire au moins 6 caractères.',
    'auth/network-request-failed': 'Pas de connexion réseau.',
    'auth/too-many-requests': 'Trop de tentatives. Réessaie dans quelques minutes.',
  };

  return new Error(messages[error.code] ?? 'Connexion impossible. Réessaie.');
}
