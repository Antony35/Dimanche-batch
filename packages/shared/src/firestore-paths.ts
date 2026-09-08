/**
 * Chemins Firestore, définis une seule fois.
 *
 * L'app et les functions doivent viser exactement les mêmes documents que les
 * Security Rules. Une chaîne de chemin écrite à la main dans un composant est
 * un bug qui ne se voit qu'en production — passer par ces helpers rend une
 * faute de frappe impossible.
 */

export const COLLECTIONS = {
  households: 'households',
  weeklyPlans: 'weeklyPlans',
  recipes: 'recipes',
  groceryLists: 'groceryLists',
  groceryItems: 'items',
  usage: 'usage',
} as const;

export const paths = {
  households: () => COLLECTIONS.households,
  household: (householdId: string) => `${COLLECTIONS.households}/${householdId}`,

  weeklyPlans: (householdId: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.weeklyPlans}`,
  weeklyPlan: (householdId: string, weekId: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.weeklyPlans}/${weekId}`,

  recipes: (householdId: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.recipes}`,
  recipe: (householdId: string, recipeId: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.recipes}/${recipeId}`,

  groceryLists: (householdId: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.groceryLists}`,
  groceryList: (householdId: string, weekId: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.groceryLists}/${weekId}`,

  groceryItems: (householdId: string, weekId: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.groceryLists}/${weekId}/${COLLECTIONS.groceryItems}`,
  groceryItem: (householdId: string, weekId: string, itemId: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.groceryLists}/${weekId}/${COLLECTIONS.groceryItems}/${itemId}`,

  usage: (householdId: string) => `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.usage}`,
  usageDay: (householdId: string, isoDate: string) =>
    `${COLLECTIONS.households}/${householdId}/${COLLECTIONS.usage}/${isoDate}`,
} as const;

/** Plafond de générations Gemini par foyer et par jour. Voir CLAUDE.md §4. */
export const DAILY_GENERATION_LIMIT = 10;
