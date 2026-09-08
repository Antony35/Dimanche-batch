import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Préférences locales à l'appareil — jamais de données de foyer ici, elles
 * vivent dans Firestore. Sert surtout à mémoriser le foyer actif pour ouvrir
 * l'app directement sur le bon écran.
 */
const KEYS = {
  activeHouseholdId: 'db.activeHouseholdId',
} as const;

export async function readActiveHouseholdId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEYS.activeHouseholdId);
  } catch {
    // Une préférence illisible n'est pas une erreur bloquante : on retombe sur
    // la résolution par requête Firestore.
    return null;
  }
}

export async function writeActiveHouseholdId(householdId: string | null): Promise<void> {
  if (householdId === null) {
    await AsyncStorage.removeItem(KEYS.activeHouseholdId);
    return;
  }
  await AsyncStorage.setItem(KEYS.activeHouseholdId, householdId);
}
