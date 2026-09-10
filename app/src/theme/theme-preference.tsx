import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

const STORAGE_KEY = 'preference.theme';

interface ThemePreferenceValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Faux tant que le disque n'a pas répondu — voir `RootLayout`. */
  isReady: boolean;
}

const ThemePreferenceContext = createContext<ThemePreferenceValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/**
 * Thème choisi par la personne, ou celui du téléphone.
 *
 * Trois états et non deux : « clair » et « sombre » sont des choix, mais
 * « système » en est un aussi — c'est le comportement par défaut, et le retirer
 * une fois qu'on a touché au réglage serait une perte.
 *
 * La préférence est locale au téléphone, pas au foyer : les deux personnes
 * n'ont pas à voir la même chose, et rien ici ne mérite un aller-retour
 * Firestore.
 */
export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setStoredPreference] = useState<ThemePreference>('system');
  const [isReady, setIsReady] = useState(false);

  // Une hydratation depuis le disque est asynchrone par nature : elle s'écrit
  // dans l'état, c'est l'exception que documente CLAUDE.md §7.
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (isThemePreference(raw)) setStoredPreference(raw);
      })
      .catch(() => {
        // Une préférence illisible n'est pas une panne : on suit le téléphone.
      })
      .finally(() => {
        if (!cancelled) setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Forcer le thème côté natif, et pas seulement dans nos couleurs : sans ça,
  // le clavier et les éléments système continueraient de suivre le téléphone,
  // et une app réglée en clair afficherait un clavier noir.
  useEffect(() => {
    // `'unspecified'` est la façon dont React Native dit « suis le téléphone ».
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference): void => {
    setStoredPreference(next);
    // L'écriture ne conditionne pas l'affichage : le thème a déjà basculé.
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  // Vingt-huit composants lisent le thème. Reconstruire cet objet à chaque
  // rendu les ferait tous re-rendre pour rien.
  const value = useMemo(
    () => ({ preference, setPreference, isReady }),
    [preference, setPreference, isReady],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreferenceValue {
  const value = useContext(ThemePreferenceContext);
  if (!value) {
    throw new Error('useThemePreference doit être appelé sous ThemePreferenceProvider.');
  }
  return value;
}
