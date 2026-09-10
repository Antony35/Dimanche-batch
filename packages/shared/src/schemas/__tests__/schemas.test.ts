import { describe, expect, it } from 'vitest';
import { GeneratedPlanSchema, GeneratedRecipeSchema } from '../gemini';
import { GenerationLockSchema } from '../generation';
import { GroceryItemSchema, GroceryListSchema } from '../grocery-list';
import { HouseholdSchema, InviteCodeSchema } from '../household';
import { RecipeSchema } from '../recipe';
import {
  GenerateWeeklyPlanInputSchema,
  RegenerateMealInputSchema,
  SetMealInputSchema,
  WeeklyPlanSchema,
} from '../weekly-plan';
import { makeGeneratedRecipe, makeRecipe, makeValidGeneratedPlan } from '../../domain/__tests__/fixtures';

/**
 * Les schémas sont la seule défense des frontières du système : réponse Gemini,
 * payload d'une callable, document Firestore relu. Un schéma trop permissif ne
 * se voit nulle part — il laisse simplement passer, et la donnée fausse ressort
 * trois écrans plus loin. Ces tests fixent ce que chacun doit refuser.
 */

function expectRejected(schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}

const INGREDIENT = { name: 'lentille', qty: 1, unit: 'g', aisle: 'epicerie' };

/** Recette valide dont un seul ingrédient est remplacé, sans passer par le typage. */
function withIngredient(ingredient: unknown): unknown {
  return { ...makeGeneratedRecipe({ slug: 'curry' }), ingredients: [ingredient] };
}

describe('GeneratedRecipeSchema', () => {
  it('accepte une recette conforme au contrat du modèle', () => {
    expect(GeneratedRecipeSchema.safeParse(makeGeneratedRecipe({ slug: 'curry' })).success).toBe(
      true,
    );
  });

  it('impose un slug en minuscules, chiffres et tirets', () => {
    // Le slug devient l'identifiant du document Firestore : une majuscule ou un
    // espace y produirait deux documents pour une même recette.
    for (const slug of ['Curry', 'curry lentilles', 'curry_lentilles', 'ab', 'curry/lentilles']) {
      expectRejected(GeneratedRecipeSchema, makeGeneratedRecipe({ slug }));
    }
  });

  it('refuse une quantité nulle ou négative', () => {
    for (const qty of [0, -1]) {
      expectRejected(GeneratedRecipeSchema, withIngredient({ ...INGREDIENT, qty }));
    }
  });

  it('refuse une unité ou un rayon hors des listes autorisées', () => {
    // Ces valeurs viennent d'un modèle, pas de notre code : le compilateur ne
    // les verra jamais, seul le schéma peut les arrêter. D'où l'objet non typé.
    expectRejected(GeneratedRecipeSchema, withIngredient({ ...INGREDIENT, unit: 'tasse' }));
    expectRejected(GeneratedRecipeSchema, withIngredient({ ...INGREDIENT, aisle: 'cave-a-vin' }));
    expectRejected(GeneratedRecipeSchema, withIngredient({ ...INGREDIENT, name: '' }));
  });

  it('exige au moins un ingrédient et une étape', () => {
    expectRejected(GeneratedRecipeSchema, makeGeneratedRecipe({ slug: 'curry', ingredients: [] }));
    expectRejected(GeneratedRecipeSchema, makeGeneratedRecipe({ slug: 'curry', steps: [] }));
  });

  it('refuse un temps de préparation non entier', () => {
    expectRejected(GeneratedRecipeSchema, makeGeneratedRecipe({ slug: 'c', prepMinutes: 25.5 }));
  });
});

describe('GeneratedPlanSchema', () => {
  it('accepte le plan de référence', () => {
    expect(GeneratedPlanSchema.safeParse(makeValidGeneratedPlan()).success).toBe(true);
  });

  it('exige exactement 7 jours', () => {
    const plan = makeValidGeneratedPlan();
    expectRejected(GeneratedPlanSchema, { ...plan, days: plan.days.slice(0, 6) });
    expectRejected(GeneratedPlanSchema, { ...plan, days: [...plan.days, plan.days[0]] });
  });

  it('exige au moins 3 recettes', () => {
    const plan = makeValidGeneratedPlan();
    expectRejected(GeneratedPlanSchema, { ...plan, recipes: plan.recipes.slice(0, 2) });
  });

  it('refuse un dayIndex hors de la semaine', () => {
    const plan = makeValidGeneratedPlan();
    const days = plan.days.map((day, index) => (index === 0 ? { ...day, dayIndex: 7 } : day));
    expectRejected(GeneratedPlanSchema, { ...plan, days });
  });

  it('accepte un repas sans recette, qui est le cas du repas pris dehors', () => {
    const plan = makeValidGeneratedPlan();
    const days = plan.days.map((day, index) =>
      index === 0 ? { ...day, lunch: { ...day.lunch, recipeSlug: null } } : day,
    );
    expect(GeneratedPlanSchema.safeParse({ ...plan, days }).success).toBe(true);
  });
});

describe('RecipeSchema', () => {
  it('accepte une recette telle que la function l’écrit', () => {
    expect(RecipeSchema.safeParse(makeRecipe({ id: 'curry' })).success).toBe(true);
  });

  it('accepte `lastUsedAt` nul mais refuse une date mal formée', () => {
    expect(RecipeSchema.safeParse(makeRecipe({ id: 'c', lastUsedAt: null })).success).toBe(true);
    expectRejected(RecipeSchema, makeRecipe({ id: 'c', lastUsedAt: '14/09/2026' }));
    expectRejected(RecipeSchema, makeRecipe({ id: 'c', lastUsedAt: '2026-9-14' }));
  });

  it('refuse un document auquel il manque un champ', () => {
    const { isFavorite: _omis, ...sansFavori } = makeRecipe({ id: 'curry' });
    expectRejected(RecipeSchema, sansFavori);
  });

  // Les recettes écrites avant le bannissement n'ont pas ce champ. Un document
  // qui ne passe pas son schéma est écarté partout où on le relit : le rendre
  // requis effacerait de l'app tout l'historique du foyer.
  it('accepte une recette antérieure au bannissement et la rend non bannie', () => {
    const { isDisliked: _omis, ...ancienne } = makeRecipe({ id: 'curry' });

    const parsed = RecipeSchema.safeParse(ancienne);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.isDisliked).toBe(false);
  });
});

describe('WeeklyPlanSchema', () => {
  const plan = {
    id: '2026-09-14',
    weekStart: '2026-09-14',
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-09-${String(14 + index).padStart(2, '0')}`,
      lunch: { recipeId: 'curry', kind: 'batch-leftover', withStarter: false, withDessert: false },
      dinner: { recipeId: null, kind: 'eat-out', withStarter: false, withDessert: false },
    })),
    recipeIds: ['curry'],
    generatedAt: 1_757_000_000_000,
    generatedBy: 'uid-alice',
    model: 'gemini-3.6-flash',
  };

  it('accepte un plan complet', () => {
    expect(WeeklyPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('exige 7 jours, ni plus ni moins', () => {
    expectRejected(WeeklyPlanSchema, { ...plan, days: plan.days.slice(0, 5) });
  });

  it('refuse un `kind` inconnu', () => {
    const days = plan.days.map((day, index) =>
      index === 0 ? { ...day, lunch: { ...day.lunch, kind: 'reheated' } } : day,
    );
    expectRejected(WeeklyPlanSchema, { ...plan, days });
  });

  it('refuse un identifiant de semaine qui n’est pas une date ISO', () => {
    expectRejected(WeeklyPlanSchema, { ...plan, id: 'semaine-38' });
  });
});

describe('GroceryItemSchema', () => {
  const item = {
    id: 'lentilles-corail--mass',
    name: 'lentilles corail',
    qty: 250,
    unit: 'g',
    aisle: 'epicerie',
    checked: false,
    fromRecipeIds: ['curry'],
  };

  it('accepte un article tel que la function l’écrit', () => {
    expect(GroceryItemSchema.safeParse(item).success).toBe(true);
  });

  it('refuse une quantité nulle : un article sans quantité n’a rien à faire dans la liste', () => {
    expectRejected(GroceryItemSchema, { ...item, qty: 0 });
  });

  it('refuse un `checked` qui ne serait pas un booléen', () => {
    // Le client n'écrit que ce champ : c'est celui qu'il faut le plus contraindre.
    expectRejected(GroceryItemSchema, { ...item, checked: 'true' });
  });

  it('accepte une liste de recettes d’origine vide', () => {
    expect(GroceryItemSchema.safeParse({ ...item, fromRecipeIds: [] }).success).toBe(true);
  });
});

describe('GroceryListSchema', () => {
  it('décrit le document parent de la sous-collection', () => {
    const list = { id: '2026-09-14', itemCount: 12, generatedAt: 1_757_000_000_000 };
    expect(GroceryListSchema.safeParse(list).success).toBe(true);
    expectRejected(GroceryListSchema, { ...list, itemCount: -1 });
    expectRejected(GroceryListSchema, { ...list, itemCount: 1.5 });
  });
});

describe('HouseholdSchema et InviteCodeSchema', () => {
  const household = {
    id: 'household-1',
    name: 'Maison',
    members: ['uid-alice'],
    inviteCode: 'BATCH-7F2K',
    createdAt: 1_757_000_000_000,
    createdBy: 'uid-alice',
  };

  it('accepte un foyer à un ou deux membres', () => {
    expect(HouseholdSchema.safeParse(household).success).toBe(true);
    expect(
      HouseholdSchema.safeParse({ ...household, members: ['uid-alice', 'uid-bob'] }).success,
    ).toBe(true);
  });

  it('refuse un foyer sans membre', () => {
    expectRejected(HouseholdSchema, { ...household, members: [] });
  });

  it('accepte un code consommé, donc nul', () => {
    expect(HouseholdSchema.safeParse({ ...household, inviteCode: null }).success).toBe(true);
  });

  it('refuse les caractères confondables dans un code', () => {
    // O/0 et I/1 ne sont pas dans l’alphabet : un code dicté ne doit pas être
    // ambigu, et le schéma doit refuser ce que le générateur ne produit pas.
    for (const code of ['BATCH-O0F2', 'BATCH-I1F2', 'BATCH-7F2', 'batch-7f2k', '7F2K']) {
      expectRejected(InviteCodeSchema, code);
    }
  });
});

describe('RegenerateMealInputSchema', () => {
  const input = {
    householdId: 'household-1',
    weekId: '2026-09-14',
    date: '2026-09-16',
    slot: 'dinner',
  };

  it('accepte un payload complet', () => {
    expect(RegenerateMealInputSchema.safeParse(input).success).toBe(true);
    expect(RegenerateMealInputSchema.safeParse({ ...input, notes: 'sans porc' }).success).toBe(true);
  });

  it('n’accepte que les deux créneaux du jour', () => {
    expectRejected(RegenerateMealInputSchema, { ...input, slot: 'snack' });
  });

  it('refuse des notes assez longues pour noyer le prompt', () => {
    expectRejected(RegenerateMealInputSchema, { ...input, notes: 'a'.repeat(501) });
  });
});

describe('WeeklyPlanSchema, le batch', () => {
  const plan = {
    id: '2026-09-12',
    weekStart: '2026-09-12',
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-09-${String(12 + index).padStart(2, '0')}`,
      lunch: { recipeId: 'curry', kind: 'batch-leftover', withStarter: false, withDessert: false },
      dinner: { recipeId: null, kind: 'eat-out', withStarter: false, withDessert: false },
    })),
    recipeIds: ['curry'],
    generatedAt: 1_757_000_000_000,
    generatedBy: 'uid-alice',
    model: 'gemini-3.6-flash',
  };

  it('accepte un plan composé avant l’introduction du batch, et rend un tableau vide', () => {
    // Le plan déjà en production n’a pas ce champ : il doit rester lisible, et
    // `buildGroceryList` retombe alors sur le comportement d’avant.
    const parsed = WeeklyPlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.batchRecipeIds).toEqual([]);
  });

  it('accepte un plan qui déclare son batch', () => {
    const parsed = WeeklyPlanSchema.safeParse({ ...plan, batchRecipeIds: ['curry', 'chili'] });
    expect(parsed.success && parsed.data.batchRecipeIds).toEqual(['curry', 'chili']);
  });

  it('refuse un identifiant de plat vide', () => {
    expectRejected(WeeklyPlanSchema, { ...plan, batchRecipeIds: [''] });
  });
});

describe('GeneratedPlanSchema, le batch', () => {
  it('exige que le modèle déclare les plats du dimanche', () => {
    const { batchRecipeSlugs: _absent, ...sansBatch } = makeValidGeneratedPlan();
    expectRejected(GeneratedPlanSchema, sansBatch);
  });

  it('refuse un batch vide', () => {
    expectRejected(GeneratedPlanSchema, { ...makeValidGeneratedPlan(), batchRecipeSlugs: [] });
  });
});

describe('SetMealInputSchema', () => {
  const base = {
    householdId: 'household-1',
    weekId: '2026-09-12',
    date: '2026-09-14',
    slot: 'dinner',
  };

  it('exige un identifiant de plat pour une portion du batch', () => {
    expect(
      SetMealInputSchema.safeParse({ ...base, meal: { choice: 'batch', recipeId: 'curry' } })
        .success,
    ).toBe(true);
    expectRejected(SetMealInputSchema, { ...base, meal: { choice: 'batch' } });
  });

  it('n’en demande aucun pour un repas à l’extérieur, et l’écarte s’il vient', () => {
    expect(SetMealInputSchema.safeParse({ ...base, meal: { choice: 'eat-out' } }).success).toBe(
      true,
    );

    // Zod retire les clés en trop plutôt que de les refuser : ce qui ressort de
    // l'union ne porte pas de `recipeId`, donc rien ne peut le lire par erreur.
    const parsed = SetMealInputSchema.safeParse({
      ...base,
      meal: { choice: 'eat-out', recipeId: 'curry' },
    });
    expect(parsed.success && parsed.data.meal).toEqual({ choice: 'eat-out' });
  });

  it('refuse un choix inconnu', () => {
    expectRejected(SetMealInputSchema, { ...base, meal: { choice: 'freezer' } });
  });
});

describe('GenerateWeeklyPlanInputSchema', () => {
  const base = { householdId: 'household-1', weekStart: '2026-09-12' };

  it('exige un nombre de plats compris entre 3 et 6', () => {
    for (const batchRecipeCount of [3, 4, 5, 6]) {
      expect(GenerateWeeklyPlanInputSchema.safeParse({ ...base, batchRecipeCount }).success).toBe(
        true,
      );
    }
    for (const batchRecipeCount of [2, 7, 4.5]) {
      expectRejected(GenerateWeeklyPlanInputSchema, { ...base, batchRecipeCount });
    }
  });
});

/**
 * Ce document est le seul que la function écrit et que les deux téléphones
 * lisent pendant qu'elle tourne. Le contrat n'est pas qu'il se relise — la
 * suite `functions` le vérifie déjà — mais qu'il **refuse** tout ce qui n'est
 * pas un code d'étape énuméré : c'est ce qui empêche un message d'erreur brut
 * ou un extrait de la réponse du modèle d'atteindre l'écran.
 */
describe('GenerationLockSchema', () => {
  const lock = { startedAt: 1_757_500_000_000, by: 'uid-alice', step: 'generating', attempt: 1 };

  it('accepte un verrou tel que la function l’écrit', () => {
    expect(GenerationLockSchema.safeParse(lock).success).toBe(true);
  });

  it('accepte les quatre étapes, et elles seules', () => {
    for (const step of ['preparing', 'generating', 'retrying', 'writing']) {
      expect(GenerationLockSchema.safeParse({ ...lock, step }).success).toBe(true);
    }
    expectRejected(GenerationLockSchema, { ...lock, step: 'terminé' });
    expectRejected(GenerationLockSchema, { ...lock, step: '' });
  });

  // La vraie raison d'être de l'énumération : sans elle, n'importe quelle
  // chaîne écrite dans ce champ s'afficherait telle quelle sur les deux
  // téléphones.
  it('refuse un message technique déposé à la place de l’étape', () => {
    expectRejected(GenerationLockSchema, {
      ...lock,
      step: 'Error: 503 Service Unavailable — models/gemini-3.6-flash',
    });
  });

  it('borne la tentative à 1 ou 2, puisqu’il n’y a qu’une reprise', () => {
    expect(GenerationLockSchema.safeParse({ ...lock, attempt: 2 }).success).toBe(true);
    expectRejected(GenerationLockSchema, { ...lock, attempt: 0 });
    expectRejected(GenerationLockSchema, { ...lock, attempt: 3 });
  });

  it('refuse un verrou incomplet', () => {
    for (const missing of ['startedAt', 'by', 'step', 'attempt']) {
      const { [missing]: _omis, ...partiel } = lock as Record<string, unknown>;
      expectRejected(GenerationLockSchema, partiel);
    }
  });

  // Zod ignore les clés inconnues : un champ parasite n'est pas refusé, il est
  // retiré. C'est la garantie réelle — la sortie ne porte que ce que le schéma
  // décrit — et elle vaut d'être écrite, faute de quoi on lui en prêterait une
  // plus forte.
  it('écarte de sa sortie toute clé qu’il ne décrit pas', () => {
    const parsed = GenerationLockSchema.safeParse({ ...lock, error: 'clé Gemini invalide' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && 'error' in parsed.data).toBe(false);
  });
});
