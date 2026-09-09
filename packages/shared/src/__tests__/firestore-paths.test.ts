import { describe, expect, it } from 'vitest';
import {
  COLLECTIONS,
  DAILY_GENERATION_LIMIT,
  GENERATION_LOCK_TTL_MS,
  paths,
} from '../firestore-paths';

/**
 * Ces chaînes doivent viser exactement les documents que `firestore.rules`
 * décrit. Une faute de frappe ne produit pas d'erreur : elle écrit à côté, dans
 * un chemin que les règles ferment, et la function échoue en production sur un
 * refus incompréhensible.
 */

const HID = 'household-1';
const WEEK = '2026-09-14';

/** Un chemin de collection a un nombre impair de segments, un document un pair. */
function segments(path: string): number {
  return path.split('/').length;
}

describe('forme des chemins', () => {
  it('distingue collections et documents par la parité des segments', () => {
    for (const collection of [
      paths.households(),
      paths.weeklyPlans(HID),
      paths.recipes(HID),
      paths.groceryLists(HID),
      paths.groceryItems(HID, WEEK),
      paths.usage(HID),
      paths.locks(HID),
    ]) {
      expect(segments(collection) % 2, `${collection} devrait être une collection`).toBe(1);
    }

    for (const document of [
      paths.household(HID),
      paths.weeklyPlan(HID, WEEK),
      paths.recipe(HID, 'curry'),
      paths.groceryList(HID, WEEK),
      paths.groceryItem(HID, WEEK, 'lentilles--mass'),
      paths.usageDay(HID, '2026-09-14'),
      paths.generationLock(HID, WEEK),
    ]) {
      expect(segments(document) % 2, `${document} devrait être un document`).toBe(0);
    }
  });

  it('place chaque document dans sa collection', () => {
    expect(paths.household(HID)).toBe(`${paths.households()}/${HID}`);
    expect(paths.weeklyPlan(HID, WEEK)).toBe(`${paths.weeklyPlans(HID)}/${WEEK}`);
    expect(paths.recipe(HID, 'curry')).toBe(`${paths.recipes(HID)}/curry`);
    expect(paths.groceryList(HID, WEEK)).toBe(`${paths.groceryLists(HID)}/${WEEK}`);
    expect(paths.usageDay(HID, WEEK)).toBe(`${paths.usage(HID)}/${WEEK}`);
    expect(paths.generationLock(HID, WEEK)).toBe(`${paths.locks(HID)}/${WEEK}`);
  });

  it('imbrique les articles sous la liste de la semaine', () => {
    // C'est cette imbrication qui permet à la règle de n'autoriser que
    // `checked` : les articles sont des documents, pas un tableau.
    expect(paths.groceryItems(HID, WEEK)).toBe(
      `${paths.groceryList(HID, WEEK)}/${COLLECTIONS.groceryItems}`,
    );
    expect(paths.groceryItem(HID, WEEK, 'sel--mass')).toBe(
      `${paths.groceryItems(HID, WEEK)}/sel--mass`,
    );
  });

  it('n’a aucune collection racine hors `households`', () => {
    const roots = new Set(
      [
        paths.households(),
        paths.weeklyPlans(HID),
        paths.recipes(HID),
        paths.groceryLists(HID),
        paths.groceryItems(HID, WEEK),
        paths.usage(HID),
        paths.locks(HID),
      ].map((path) => path.split('/')[0]),
    );
    expect([...roots]).toEqual([COLLECTIONS.households]);
  });
});

describe('constantes de garde', () => {
  it('DAILY_GENERATION_LIMIT est un entier positif : le rempart devant la clé', () => {
    expect(Number.isInteger(DAILY_GENERATION_LIMIT)).toBe(true);
    expect(DAILY_GENERATION_LIMIT).toBeGreaterThan(0);
  });

  it('le TTL du verrou dépasse le timeout des functions', () => {
    // 120 s côté function : un verrou qui expirerait avant laisserait deux
    // générations se chevaucher, ce qu'il est justement censé empêcher.
    expect(GENERATION_LOCK_TTL_MS).toBeGreaterThan(120_000);
  });
});
