import AsyncStorage from '@react-native-async-storage/async-storage';
import type { z } from 'zod';

/**
 * Cache offline explicite.
 *
 * Le SDK JS de Firestore n'a pas de persistance offline sur React Native : son
 * cache vit en mémoire et disparaît avec l'app. Sans ce qui suit, rouvrir
 * l'application dans un magasin sans réseau afficherait une liste vide.
 *
 * Ce qui est relu ici est une donnée externe comme une autre — écrite par une
 * version antérieure de l'app, peut-être avec un autre schéma. Elle traverse
 * donc Zod avant d'être utilisée, exactement comme un document Firestore.
 */

export const cacheKeys = {
  weeklyPlan: (householdId: string, weekId: string) => `cache.plan.${householdId}.${weekId}`,
  groceryItems: (householdId: string, weekId: string) => `cache.grocery.${householdId}.${weekId}`,
  recipes: (householdId: string) => `cache.recipes.${householdId}`,
} as const;

export async function readCache<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    // Un cache illisible n'est pas une panne : on repart du réseau.
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Écrire le cache est un confort, jamais une condition de fonctionnement.
  }
}
