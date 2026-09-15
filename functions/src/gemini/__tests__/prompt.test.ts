import { describe, expect, it } from 'vitest';
import {
  COOKING_SESSION_SYSTEM_INSTRUCTION,
  MEAL_REPLACEMENT_SYSTEM_INSTRUCTION,
  PROMPT_VERSION,
  SYSTEM_INSTRUCTION,
  buildBatchRecipePrompt,
  buildCookingSessionPrompt,
  buildMealReplacementPrompt,
  buildPlanPrompt,
  buildRetryPrompt,
  type PlanPromptInput,
} from '../prompt';

/**
 * Le prompt est la seule pièce du système qu'on ne peut pas prouver correcte :
 * ce qu'il produit dépend d'un modèle. Ce qu'on peut fixer, en revanche, c'est
 * ce qu'il contient — et ce qu'il ne doit jamais demander en même temps.
 */

const base: PlanPromptInput = {
  weekStart: '2026-09-19',
  batchRecipeCount: 3,
  vegetarianCount: 0,
  recentRecipeNames: [],
};

describe('buildPlanPrompt', () => {
  it('dit combien de plats le foyer veut préparer', () => {
    expect(buildPlanPrompt({ ...base, batchRecipeCount: 5 })).toContain('exactement 5 plats');
  });

  /**
   * Le modèle ne calcule plus les portions : il les reçoit. C'est ce qui a mis
   * fin aux plats à 7 portions, donc aux demi-assiettes.
   */
  it('impose la répartition des repas et les portions de chaque plat', () => {
    const three = buildPlanPrompt(base);
    expect(three).toContain('un plat servi à 4 repas (8 portions)');
    expect(three).toContain('deux plats servis à 3 repas (6 portions)');

    const six = buildPlanPrompt({ ...base, batchRecipeCount: 6 });
    expect(six).toContain('quatre plats servis à 2 repas (4 portions)');
    expect(six).toContain('deux plats servis à 1 repas (2 portions)');
  });

  it('nomme la semaine en français', () => {
    expect(buildPlanPrompt(base)).toContain('du 19 au 25 septembre');
  });

  it('demande exactement le nombre de plats végétariens choisi', () => {
    const prompt = buildPlanPrompt({ ...base, vegetarianCount: 2 });
    expect(prompt).toContain('Exactement 2 de ces plats sont végétariens');
  });

  it('dit qu’aucun compte végétarien n’est imposé quand le foyer n’en veut pas', () => {
    const prompt = buildPlanPrompt(base);
    expect(prompt).not.toContain('Exactement 0');
    expect(prompt).toContain('aucun nombre de plats végétariens');
  });

  it('envoie les légumes du mois de la semaine visée', () => {
    const september = buildPlanPrompt(base);
    expect(september).toContain('Légumes de saison');
    expect(september).toContain('courge butternut');

    const january = buildPlanPrompt({ ...base, weekStart: '2027-01-09' });
    expect(january).toContain('topinambour');
    expect(january).not.toContain('tomate,');
  });

  it('n’encombre pas le prompt de sections vides', () => {
    const prompt = buildPlanPrompt(base);
    expect(prompt).not.toContain('favori');
    expect(prompt).not.toContain("n'en veut plus");
    expect(prompt).not.toContain('servis lors des dernières semaines');
  });

  it('interdit les plats bannis sans réserve, contrairement aux plats récents', () => {
    const prompt = buildPlanPrompt({
      ...base,
      bannedRecipeNames: ['Gratin de courgettes', 'Bœuf carottes'],
    });
    expect(prompt).toContain('sous aucun prétexte');
    expect(prompt).toContain('- Gratin de courgettes');
    expect(prompt).toContain('- Bœuf carottes');
  });

  it('liste les plats récents comme interdits', () => {
    const prompt = buildPlanPrompt({
      ...base,
      recentRecipeNames: ['Curry de lentilles', 'Soupe de poireaux'],
    });
    expect(prompt).toContain('ne les repropose pas');
    expect(prompt).toContain('- Curry de lentilles');
    expect(prompt).toContain('- Soupe de poireaux');
  });

  it('propose les favoris sans les imposer, et un seul au plus', () => {
    const prompt = buildPlanPrompt({ ...base, favoriteRecipeNames: ['Chili sin carne'] });
    expect(prompt).toContain('favori');
    expect(prompt).toContain('au maximum');
    expect(prompt).toContain('- Chili sin carne');
  });
});

describe('buildMealReplacementPrompt', () => {
  it('situe le repas le samedi ou le dimanche et nomme le créneau', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 0,
      slot: 'dinner',
      date: '2026-09-19',
      currentRecipeName: null,
      otherRecipeNames: ['Curry de lentilles'],
    });

    expect(prompt).toContain('soir');
    expect(prompt).toContain('samedi');
    expect(prompt).toContain('deux portions');
  });

  it('impose la casserole unique et le temps d’un one-pot quand il est demandé', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 1,
      slot: 'lunch',
      date: '2026-09-20',
      style: 'one-pot',
      currentRecipeName: null,
      otherRecipeNames: [],
    });
    expect(prompt).toContain('one-pot');
    expect(prompt).toContain('45 minutes');
  });

  it('interdit aussi les plats bannis lors d’un remplacement', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 0,
      slot: 'lunch',
      date: '2026-09-19',
      currentRecipeName: 'Gratin de courgettes',
      otherRecipeNames: [],
      bannedRecipeNames: ['Gratin de courgettes'],
    });

    expect(prompt).toContain('sous aucun prétexte');
    expect(prompt).toContain('- Gratin de courgettes');
  });

  it('exclut le plat en place et ceux du reste de la semaine', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 1,
      slot: 'lunch',
      date: '2026-09-20',
      currentRecipeName: 'Soupe de poireaux',
      otherRecipeNames: ['Curry de lentilles'],
    });

    expect(prompt).toContain('midi');
    expect(prompt).toContain('Soupe de poireaux');
    expect(prompt).toContain('- Curry de lentilles');
    expect(prompt).toContain('doublon');
  });
});

describe('buildBatchRecipePrompt', () => {
  const input = {
    currentRecipeName: 'Curry',
    servedMeals: 3,
    needsFreezing: false,
    otherBatchMinutes: 100,
    otherRecipeNames: ['Chili'],
  };

  it('demande exactement les portions des repas repris', () => {
    expect(buildBatchRecipePrompt(input)).toContain('exactement 6 portions');
  });

  it('exige un plat qui cuit seul quand le plat remplacé était le seul', () => {
    expect(buildBatchRecipePrompt({ ...input, requiredSlowCook: 'either' })).toContain(
      '« mijote » ou « four-lent »',
    );
    expect(buildBatchRecipePrompt({ ...input, requiredSlowCook: 'four-lent' })).toContain(
      'un plat « four-lent »',
    );
    expect(buildBatchRecipePrompt(input)).not.toContain('cuisait seul');
  });
});

describe('buildRetryPrompt', () => {
  it('reprend la demande, les violations et la proposition refusée', () => {
    const prompt = buildRetryPrompt(
      'Compose le batch.',
      [{ code: 'batch-servings', message: '« Curry » doit produire exactement 8 portions.' }],
      { recipes: [] },
    );

    expect(prompt).toContain('Compose le batch.');
    expect(prompt).toContain('- « Curry » doit produire exactement 8 portions.');
    expect(prompt).toContain('{"recipes":[]}');
    expect(prompt).toContain('corrige ces points');
  });
});

describe('instructions système', () => {
  it('partagent les exigences de recette sans les recopier', () => {
    // Deux textes qui doivent dire la même chose finissent par diverger : le
    // bloc est partagé, ce test le vérifie plutôt que de l'espérer.
    for (const bloc of ['INGRÉDIENTS', 'ÉTAPES', 'CUISINE', 'ÉTIQUETTES', 'TEMPS']) {
      expect(SYSTEM_INSTRUCTION).toContain(bloc);
      expect(MEAL_REPLACEMENT_SYSTEM_INSTRUCTION).toContain(bloc);
    }
  });

  it('ne décrivent au modèle que le lundi au vendredi', () => {
    // Le samedi et le dimanche sont décidés par le foyer après la génération.
    expect(SYSTEM_INSTRUCTION).toContain('ON NE CUISINE PAS');
    expect(SYSTEM_INSTRUCTION).toContain('2 (lundi)');
    expect(SYSTEM_INSTRUCTION).toContain('6 (vendredi)');
    expect(SYSTEM_INSTRUCTION).toContain('ne te concernent pas');
    expect(SYSTEM_INSTRUCTION).not.toContain('"cooked"');
  });

  it('interdit au modèle de calculer les portions', () => {
    expect(SYSTEM_INSTRUCTION).toContain('ne les calcule pas');
    expect(SYSTEM_INSTRUCTION).toContain('EXACTEMENT');
  });

  it('énonce la règle du plat qui cuit seul et ne compte que la présence', () => {
    expect(SYSTEM_INSTRUCTION).toContain('"mijote" ET un "four-lent"');
    expect(SYSTEM_INSTRUCTION).toContain('cookMinutes) ne compte pas');
  });

  it('ne demande le one-pot qu’au remplacement qui le réclame', () => {
    // Composer le batch n'a pas besoin de plats rapides : tout se cuisine le
    // dimanche. C'est le style demandé pour un samedi qui l'impose.
    expect(SYSTEM_INSTRUCTION).not.toContain('one-pot');
  });

  it('demande les plats du batch dans l’ordre de préparation', () => {
    // C'est cet ordre que suit l'écran de préparation du dimanche.
    expect(SYSTEM_INSTRUCTION).toContain("DANS L'ORDRE");
  });

  it('porte la version 10, stockée avec chaque plan', () => {
    expect(PROMPT_VERSION).toBe(10);
  });
});

describe('buildCookingSessionPrompt', () => {
  const prompt = buildCookingSessionPrompt({
    recipes: [
      {
        id: 'bourguignon',
        name: 'Bourguignon',
        cookMinutes: 150,
        ingredients: [
          { name: 'oignon', toCut: true },
          { name: 'huile d’olive', toCut: false },
        ],
        steps: ['Émincer l’oignon et le faire revenir.', 'Mijoter.'],
      },
      {
        id: 'chili',
        name: 'Chili',
        cookMinutes: 0,
        ingredients: [{ name: 'poivron', toCut: true }],
        steps: ['Cuire.'],
      },
    ],
  });

  // Le modèle doit citer ces identifiants : sans eux dans le prompt, il
  // inventerait des noms que le validateur refuserait.
  it('donne chaque plat avec son identifiant exact', () => {
    expect(prompt).toContain('identifiant bourguignon');
    expect(prompt).toContain('identifiant chili');
  });

  it('marque les ingrédients à couper, et eux seuls', () => {
    expect(prompt).toContain('- oignon (à couper)');
    expect(prompt).toContain('- huile d’olive\n');
    expect(prompt).not.toContain('huile d’olive (à couper)');
  });

  it('dit quel plat cuit longtemps sans surveillance', () => {
    expect(prompt).toContain('150 min de cuisson sans surveillance');
    // Le chili ne cuit pas seul : sa ligne s'arrête à son identifiant.
    expect(prompt).toContain('identifiant chili\n');
  });

  it('numérote les étapes de chaque recette', () => {
    expect(prompt).toContain('1. Émincer l’oignon et le faire revenir.');
    expect(prompt).toContain('2. Mijoter.');
  });

  it('interdit de redemander une découpe et d’écrire des quantités', () => {
    expect(COOKING_SESSION_SYSTEM_INSTRUCTION).toContain('Tout est déjà coupé');
    expect(COOKING_SESSION_SYSTEM_INSTRUCTION).toContain("N'écris aucune quantité");
    expect(COOKING_SESSION_SYSTEM_INSTRUCTION).toContain('EXACTEMENT comme la recette');
  });

  it('demande un temps par plat, qui concorde avec ses étapes', () => {
    expect(COOKING_SESSION_SYSTEM_INSTRUCTION).toContain('"timings"');
    expect(COOKING_SESSION_SYSTEM_INSTRUCTION).toContain('concorde avec les durées');
    expect(SYSTEM_INSTRUCTION).toContain('CONCORDENT avec "cookMinutes"');
  });
});
