import { describe, expect, it } from 'vitest';
import {
  MAX_BATCH_RECIPES,
  MAX_BATCH_TOTAL_MINUTES,
  MIN_BATCH_RECIPES,
  MIN_SLOW_COOK_MINUTES,
  cookTimeViolations,
  parseDurations,
  SERVINGS_PER_MEAL,
  WEEKDAY_MEAL_COUNT,
  describeViolations,
  distributeMeals,
  distributePortions,
  requiredSlowCookTag,
  slowCookViolations,
  validateGeneratedPlan,
  validateBatchRecipeReplacement,
  validateMealReplacement,
  type BatchReplacementContext,
  type PlanValidationOptions,
} from '../plan-constraints';
import { makeGeneratedDays, makeGeneratedRecipe, makeValidGeneratedPlan } from './fixtures';
import type { GeneratedPlan } from '../../schemas/gemini';

function codes(plan: GeneratedPlan, options: PlanValidationOptions = {}): string[] {
  return validateGeneratedPlan(plan, options).map((violation) => violation.code);
}

function recipe(plan: GeneratedPlan, slug: string) {
  const found = plan.recipes.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`recette ${slug} absente de la fixture`);
  return found;
}

describe('validateGeneratedPlan, structure', () => {
  it('accepte un plan conforme à la semaine type', () => {
    expect(validateGeneratedPlan(makeValidGeneratedPlan())).toEqual([]);
  });

  it('refuse une portion servie depuis un plat hors du batch', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes.push(makeGeneratedRecipe({ slug: 'intrus' }));
    plan.days[0]!.lunch = { ...plan.days[0]!.lunch, recipeSlug: 'intrus' };

    expect(codes(plan)).toContain('leftover-not-from-batch');
  });

  // Le plan ne contient plus que le batch : le samedi et le dimanche sont
  // décidés après, par le foyer. Une recette hors batch n'a rien à y faire.
  it('refuse une recette qui n’est pas dans le batch', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes.push(makeGeneratedRecipe({ slug: 'risotto-weekend', name: 'Risotto' }));

    expect(codes(plan)).toContain('recipe-not-in-batch');
  });

  it('signale une référence vers une recette inexistante', () => {
    const plan = makeValidGeneratedPlan();
    plan.days[0]!.dinner = { ...plan.days[0]!.dinner, recipeSlug: 'inconnue' };

    expect(codes(plan)).toContain('unknown-slug');
  });

  it('exige exactement les jours du lundi au vendredi', () => {
    const doubled = makeValidGeneratedPlan();
    doubled.days = [...doubled.days.slice(0, 4), { ...doubled.days[0]! }];
    expect(codes(doubled)).toContain('day-index');

    const missing = makeValidGeneratedPlan();
    missing.days = missing.days.slice(0, 4);
    expect(codes(missing)).toContain('day-index');
  });

  it('refuse deux recettes portant le même slug', () => {
    // Le slug devient l'identifiant du document : deux recettes homonymes
    // n'en écriraient qu'une, et le plan citerait la mauvaise.
    const plan = makeValidGeneratedPlan();
    plan.recipes[1]!.slug = plan.recipes[0]!.slug;

    expect(codes(plan)).toContain('duplicate-slug');
  });
});

describe('validateGeneratedPlan, batch', () => {
  it('exige un batch d’au moins trois plats', () => {
    const plan = makeValidGeneratedPlan();
    plan.batchRecipeSlugs = ['batch-curry', 'chili-sin-carne'];

    expect(codes(plan)).toContain('batch-size');
  });

  it('exige exactement le nombre de plats demandé par le foyer', () => {
    const violations = validateGeneratedPlan(makeValidGeneratedPlan(), { expectedBatchCount: 5 });

    expect(violations.map((v) => v.code)).toContain('batch-size');
    expect(violations[0]?.message).toContain('3 plats');
    expect(violations[0]?.message).toContain('exactement 5');
  });

  it('refuse un plat déclaré deux fois dans le batch', () => {
    const plan = makeValidGeneratedPlan();
    plan.batchRecipeSlugs = ['batch-curry', 'batch-curry', 'chili-sin-carne'];

    expect(codes(plan)).toContain('batch-size');
  });

  it('refuse un plat du batch absent des recettes', () => {
    const plan = makeValidGeneratedPlan();
    plan.batchRecipeSlugs = [...plan.batchRecipeSlugs, 'plat-fantome'];

    expect(codes(plan)).toContain('batch-unknown-slug');
  });

  it('refuse un plat du batch qui ne sert aucun repas', () => {
    const plan = makeValidGeneratedPlan();
    plan.days = makeGeneratedDays({
      2: ['batch-curry', 'batch-curry'],
      3: ['batch-curry', 'batch-curry'],
      4: ['chili-sin-carne', 'chili-sin-carne'],
      5: ['chili-sin-carne', 'chili-sin-carne'],
      6: ['chili-sin-carne', 'chili-sin-carne'],
    });

    expect(codes(plan)).toContain('batch-unused');
  });

  it('refuse un batch qui ne tient pas dans un après-midi', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes = plan.recipes.map((entry) => ({ ...entry, prepMinutes: 120 }));

    const violations = validateGeneratedPlan(plan);
    expect(violations.map((v) => v.code)).toContain('batch-too-long');
    expect(violations.find((v) => v.code === 'batch-too-long')?.message).toContain(
      String(MAX_BATCH_TOTAL_MINUTES),
    );
  });

  // Un mijoté de trois heures n'occupe le cuisinier que le temps de le lancer.
  it('ne compte pas la cuisson sans surveillance dans le temps du dimanche', () => {
    const plan = makeValidGeneratedPlan();
    recipe(plan, 'batch-curry').cookMinutes = 240;

    expect(codes(plan)).not.toContain('batch-too-long');
  });
});

/**
 * 8, 6 et 6 portions pour trois plats : c'est ce qu'on annonce au foyer avant
 * de générer, et ce que le modèle doit tenir exactement.
 */
describe('validateGeneratedPlan, portions', () => {
  it('exige exactement deux portions par repas servi', () => {
    const plan = makeValidGeneratedPlan();
    recipe(plan, 'batch-curry').servings = 10;

    const violations = validateGeneratedPlan(plan);
    const message = violations.find((v) => v.code === 'batch-servings')?.message ?? '';
    // Le message est chiffré : c'est ce qui rend une seule reprise suffisante.
    expect(message).toContain('4 repas');
    expect(message).toContain('exactement 8 portions');
    expect(message).toContain('pas 10');
  });

  it('refuse aussi un plat qui en produit trop peu', () => {
    const plan = makeValidGeneratedPlan();
    recipe(plan, 'soupe-poireaux').servings = 4;

    expect(codes(plan)).toContain('batch-servings');
  });

  it('exige la répartition annoncée, pas seulement le bon total', () => {
    // 5, 3, 2 fait bien dix repas, mais on a annoncé 4, 3, 3 au foyer.
    const plan = makeValidGeneratedPlan();
    plan.days = makeGeneratedDays({
      2: ['batch-curry', 'batch-curry'],
      3: ['batch-curry', 'batch-curry'],
      4: ['batch-curry', 'chili-sin-carne'],
      5: ['chili-sin-carne', 'chili-sin-carne'],
      6: ['soupe-poireaux', 'soupe-poireaux'],
    });
    recipe(plan, 'batch-curry').servings = 10;
    recipe(plan, 'soupe-poireaux').servings = 4;

    const violations = validateGeneratedPlan(plan);
    expect(violations.map((v) => v.code)).toEqual(['batch-distribution']);
    expect(violations[0]?.message).toContain('5, 3, 2');
    expect(violations[0]?.message).toContain('4, 3, 3');
  });

  it('exige que les plats de fin de semaine se congèlent', () => {
    // Cuisiné dimanche, mangé vendredi : cinq jours au frigo.
    const plan = makeValidGeneratedPlan();
    const soupe = recipe(plan, 'soupe-poireaux');
    soupe.tags = soupe.tags.filter((tag) => tag !== 'congelable');

    expect(codes(plan)).toContain('batch-not-freezable');
  });

  it('n’exige rien de tel d’un plat servi en début de semaine', () => {
    // Le curry est servi lundi et mardi : deux jours au frigo, pas besoin.
    expect(codes(makeValidGeneratedPlan())).not.toContain('batch-not-freezable');
  });
});

/**
 * Le dimanche s'organise autour d'un plat qui cuit seul pendant qu'on prépare
 * les autres.
 */
describe('validateGeneratedPlan, plat qui cuit longtemps', () => {
  it('exige au moins un mijoté ou un plat au four pour trois ou quatre plats', () => {
    const plan = makeValidGeneratedPlan();
    const curry = recipe(plan, 'batch-curry');
    curry.tags = curry.tags.filter((tag) => tag !== 'mijote');

    expect(codes(plan)).toContain('batch-slow-cook');
  });

  it('accepte le four à la place du mijoté', () => {
    const plan = makeValidGeneratedPlan();
    const curry = recipe(plan, 'batch-curry');
    curry.tags = [...curry.tags.filter((tag) => tag !== 'mijote'), 'four-lent'];

    expect(codes(plan)).not.toContain('batch-slow-cook');
  });

  it('exige un mijoté ET un plat au four à partir de cinq plats', () => {
    const recipes = [
      { name: 'a', tags: ['mijote' as const], cookMinutes: 90 },
      { name: 'b', tags: [], cookMinutes: 0 },
      { name: 'c', tags: [], cookMinutes: 0 },
      { name: 'd', tags: [], cookMinutes: 0 },
      { name: 'e', tags: [], cookMinutes: 0 },
    ];
    expect(slowCookViolations(recipes, 5).map((v) => v.code)).toEqual(['batch-slow-cook']);

    recipes[1] = { name: 'b', tags: ['four-lent' as never], cookMinutes: 120 };
    expect(slowCookViolations(recipes, 5)).toEqual([]);
  });

  it('refuse une étiquette qu’aucune cuisson longue ne justifie', () => {
    const plan = makeValidGeneratedPlan();
    recipe(plan, 'batch-curry').cookMinutes = MIN_SLOW_COOK_MINUTES - 1;

    expect(codes(plan)).toContain('slow-cook-too-short');
  });
});

describe('validateGeneratedPlan, végétarien', () => {
  function withVegetarian(slugs: string[]): GeneratedPlan {
    const plan = makeValidGeneratedPlan();
    for (const slug of slugs) recipe(plan, slug).tags.push('vegetarien');
    return plan;
  }

  it('exige exactement le nombre de plats végétariens choisi', () => {
    expect(codes(withVegetarian(['chili-sin-carne']), { expectedVegetarianCount: 1 })).toEqual([]);

    const tooFew = validateGeneratedPlan(withVegetarian(['chili-sin-carne']), {
      expectedVegetarianCount: 2,
    });
    expect(tooFew.map((v) => v.code)).toEqual(['batch-vegetarian-count']);
    expect(tooFew[0]?.message).toContain('exactement 2');

    expect(
      codes(withVegetarian(['chili-sin-carne', 'soupe-poireaux']), { expectedVegetarianCount: 1 }),
    ).toContain('batch-vegetarian-count');
  });

  it('ne contraint rien quand le foyer n’a rien demandé', () => {
    expect(codes(withVegetarian(['chili-sin-carne']), { expectedVegetarianCount: 0 })).toEqual([]);
    expect(codes(withVegetarian([]))).toEqual([]);
  });

  // L'étiquette est une déclaration du modèle, pas une preuve.
  it('refuse un plat marqué végétarien qui contient de la viande ou du poisson', () => {
    const plan = withVegetarian(['chili-sin-carne']);
    recipe(plan, 'chili-sin-carne').ingredients.push({
      name: 'lardon',
      qty: 100,
      unit: 'g',
      aisle: 'boucherie',
    });

    const violations = validateGeneratedPlan(plan, { expectedVegetarianCount: 1 });
    expect(violations.map((v) => v.code)).toContain('vegetarian-has-meat');
    expect(violations.find((v) => v.code === 'vegetarian-has-meat')?.message).toContain('lardon');
  });
});

/**
 * On ne cuisine plus en semaine : une recette ne se génère que pour le samedi
 * ou le dimanche, et le style demandé est tenu.
 */
describe('validateMealReplacement', () => {
  const rapide = makeGeneratedRecipe({ slug: 'chili', tags: ['one-pot'], prepMinutes: 30 });
  const longue = makeGeneratedRecipe({ slug: 'gratin', tags: ['healthy'], prepMinutes: 90 });

  it('accepte une recette pour le samedi ou le dimanche', () => {
    expect(validateMealReplacement(longue, 0)).toEqual([]);
    expect(validateMealReplacement(longue, 1)).toEqual([]);
  });

  it('refuse toute recette un jour de semaine, nourri par le batch', () => {
    for (const dayIndex of [2, 3, 4, 5, 6]) {
      expect(validateMealReplacement(rapide, dayIndex).map((v) => v.code)).toEqual([
        'weekend-only',
      ]);
    }
    expect(validateMealReplacement(rapide, 7).map((v) => v.code)).toEqual(['weekend-only']);
  });

  it('impose une casserole et trois quarts d’heure quand un one-pot est demandé', () => {
    const violations = validateMealReplacement(longue, 0, { style: 'one-pot' }).map((v) => v.code);
    expect(violations).toContain('not-one-pot');
    expect(violations).toContain('one-pot-too-long');
    expect(validateMealReplacement(rapide, 0, { style: 'one-pot' })).toEqual([]);
  });

  it('laisse le champ libre pour un plat élaboré', () => {
    expect(validateMealReplacement(longue, 1, { style: 'elaborate' })).toEqual([]);
  });

  it('refuse un plat banni', () => {
    const rejete = makeGeneratedRecipe({ slug: 'gratin-courgettes', name: 'Gratin de courgettes' });

    expect(
      validateMealReplacement(rejete, 0, { bannedNames: ['Gratin de courgettes'] }).map(
        (v) => v.code,
      ),
    ).toContain('banned-recipe');
  });
});

describe('describeViolations', () => {
  it('rend une puce par violation, prête à réinjecter dans le prompt', () => {
    const plan = makeValidGeneratedPlan();
    plan.batchRecipeSlugs = ['batch-curry'];
    const violations = validateGeneratedPlan(plan);

    const text = describeViolations(violations);
    expect(violations.length).toBeGreaterThan(0);
    expect(text.split('\n')).toHaveLength(violations.length);
    for (const violation of violations) {
      expect(text).toContain(`- ${violation.message}`);
    }
  });

  it('rend une chaîne vide pour un plan conforme', () => {
    expect(describeViolations(validateGeneratedPlan(makeValidGeneratedPlan()))).toBe('');
  });
});

/**
 * Le bannissement est la seule contrainte que le foyer écrit lui-même. Un faux
 * positif refuserait une recette légitime et coûterait une reprise ; un faux
 * négatif servirait à l'utilisateur le plat qu'il vient de rejeter.
 */
describe('bannissement', () => {
  function bannedCodes(bannedNames: string[]): string[] {
    const plan = makeValidGeneratedPlan();
    plan.recipes[0]!.name = 'Curry de lentilles corail';
    return codes(plan, { bannedNames }).filter((code) => code === 'banned-recipe');
  }

  it('refuse un plat dont le nom est banni', () => {
    expect(bannedCodes(['Curry de lentilles corail'])).toEqual(['banned-recipe']);
  });

  it('ignore la casse, les accents et les espaces en trop', () => {
    expect(bannedCodes(['  CURRY  DE LENTILLES CORAÎL '])).toEqual(['banned-recipe']);
  });

  it('laisse passer un plat au nom seulement voisin', () => {
    expect(bannedCodes(['Curry de pois chiches'])).toEqual([]);
    expect(bannedCodes(['Curry'])).toEqual([]);
  });

  it('ne refuse rien quand le foyer n’a rien banni', () => {
    expect(bannedCodes([])).toEqual([]);
  });

  it('nomme le plat fautif, puisque le message repart dans la reprise', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes[0]!.name = 'Curry de lentilles corail';

    const violation = validateGeneratedPlan(plan, {
      bannedNames: ['curry de lentilles corail'],
    }).find((v) => v.code === 'banned-recipe');

    expect(violation?.message).toContain('Curry de lentilles corail');
  });
});

describe('validateBatchRecipeReplacement', () => {
  const mijote = { name: 'Curry', tags: ['mijote' as const], cookMinutes: 90 };
  const simple = { name: 'Salade', tags: [], cookMinutes: 0 };

  const base: BatchReplacementContext = {
    servedMeals: 4,
    servedDayIndexes: [2, 3],
    otherBatchMinutes: 100,
    otherBatchRecipes: [mijote, simple],
    replacedRecipe: simple,
  };

  const batchCodes = (
    replacement: Parameters<typeof validateBatchRecipeReplacement>[0],
    context = base,
  ) => validateBatchRecipeReplacement(replacement, context).map((violation) => violation.code);

  it('accepte un plat qui couvre ses repas et tient dans l’après-midi', () => {
    const replacement = makeGeneratedRecipe({ slug: 'tajine', servings: 8, prepMinutes: 60 });
    expect(batchCodes(replacement)).toEqual([]);
  });

  it('exige exactement les portions des repas qu’il reprend', () => {
    expect(batchCodes(makeGeneratedRecipe({ slug: 'tajine', servings: 6 }))).toContain(
      'batch-servings',
    );
    expect(batchCodes(makeGeneratedRecipe({ slug: 'tajine', servings: 12 }))).toContain(
      'batch-servings',
    );
  });

  it('exige la congélation quand le plat est servi en fin de semaine', () => {
    const replacement = makeGeneratedRecipe({ slug: 'tajine', servings: 8, prepMinutes: 60 });
    expect(batchCodes(replacement, { ...base, servedDayIndexes: [5, 6] })).toContain(
      'batch-not-freezable',
    );

    const congelable = makeGeneratedRecipe({
      slug: 'tajine',
      servings: 8,
      prepMinutes: 60,
      tags: ['congelable'],
    });
    expect(batchCodes(congelable, { ...base, servedDayIndexes: [5, 6] })).toEqual([]);
  });

  // Le plafond porte sur le batch entier : les autres plats restent en place.
  it('compte le temps des autres plats, pas seulement celui du remplaçant', () => {
    const replacement = makeGeneratedRecipe({ slug: 'tajine', servings: 8, prepMinutes: 60 });
    expect(batchCodes(replacement, { ...base, otherBatchMinutes: 200 })).toContain(
      'batch-too-long',
    );
  });

  it('refuse de remplacer le seul mijoté par un plat qui ne cuit pas seul', () => {
    const replacement = makeGeneratedRecipe({ slug: 'tajine', servings: 8, tags: ['healthy'] });
    const context = { ...base, otherBatchRecipes: [simple, simple], replacedRecipe: mijote };

    expect(batchCodes(replacement, context)).toContain('batch-slow-cook');
  });

  // Un plan composé avant la règle n'a aucun plat marqué : on ne la lui impose
  // pas au premier remplacement.
  it('n’impose pas la règle à un batch qui ne la tenait pas', () => {
    const replacement = makeGeneratedRecipe({ slug: 'tajine', servings: 8, tags: ['healthy'] });
    const context = { ...base, otherBatchRecipes: [simple, simple], replacedRecipe: simple };

    expect(batchCodes(replacement, context)).toEqual([]);
  });

  it('refuse un plat banni', () => {
    const replacement = makeGeneratedRecipe({
      slug: 'tajine',
      name: 'Tajine d’agneau',
      servings: 8,
      prepMinutes: 60,
    });
    expect(batchCodes(replacement, { ...base, bannedNames: ['tajine d’agneau'] })).toContain(
      'banned-recipe',
    );
  });
});

/**
 * Le calcul que le modèle faisait à notre place, et qu'il ratait.
 *
 * Diviser 20 portions par 3 plats donne 7, 7 et 6 : le plat à 7 portions se
 * mange en trois repas et demi, donc quelqu'un finit devant une demi-assiette.
 * En répartissant les 10 repas, chaque plat en sert un nombre entier.
 */
describe('distributeMeals', () => {
  it('répartit les dix repas au plus égal, les grosses parts d’abord', () => {
    expect(distributeMeals(WEEKDAY_MEAL_COUNT, 3)).toEqual([4, 3, 3]);
    expect(distributeMeals(WEEKDAY_MEAL_COUNT, 4)).toEqual([3, 3, 2, 2]);
    expect(distributeMeals(WEEKDAY_MEAL_COUNT, 5)).toEqual([2, 2, 2, 2, 2]);
    expect(distributeMeals(WEEKDAY_MEAL_COUNT, 6)).toEqual([2, 2, 2, 2, 1, 1]);
  });

  it('distribue tous les repas, sans en perdre ni en inventer', () => {
    for (let dishes = MIN_BATCH_RECIPES; dishes <= MAX_BATCH_RECIPES; dishes += 1) {
      const meals = distributeMeals(WEEKDAY_MEAL_COUNT, dishes);
      expect(meals).toHaveLength(dishes);
      expect(meals.reduce((total, part) => total + part, 0)).toBe(WEEKDAY_MEAL_COUNT);
      expect(Math.min(...meals)).toBeGreaterThan(0);
    }
  });

  it('ne rend rien pour zéro plat, plutôt qu’une division par zéro', () => {
    expect(distributeMeals(WEEKDAY_MEAL_COUNT, 0)).toEqual([]);
  });

  // C'est l'exemple qui a motivé la règle : 8, 6 et 6, jamais 7, 7 et 6.
  it('donne des portions toujours paires', () => {
    expect(distributePortions(3)).toEqual([8, 6, 6]);
    expect(distributePortions(4)).toEqual([6, 6, 4, 4]);
    for (let dishes = MIN_BATCH_RECIPES; dishes <= MAX_BATCH_RECIPES; dishes += 1) {
      for (const portions of distributePortions(dishes)) {
        expect(portions % SERVINGS_PER_MEAL).toBe(0);
      }
    }
  });
});

describe('requiredSlowCookTag', () => {
  const mijote = { name: 'Curry', tags: ['mijote' as const], cookMinutes: 90 };
  const four = { name: 'Gratin', tags: ['four-lent' as const], cookMinutes: 90 };
  const simple = { name: 'Salade', tags: [], cookMinutes: 0 };

  it('ne demande rien quand les autres plats tiennent déjà la règle', () => {
    expect(requiredSlowCookTag([mijote, simple], simple)).toBeUndefined();
  });

  it('demande un plat qui cuit seul quand on remplace le seul mijoté', () => {
    expect(requiredSlowCookTag([simple, simple], mijote)).toBe('either');
  });

  it('nomme l’étiquette manquante à partir de cinq plats', () => {
    expect(requiredSlowCookTag([mijote, simple, simple, simple], four)).toBe('four-lent');
    expect(requiredSlowCookTag([four, simple, simple, simple], mijote)).toBe('mijote');
  });

  it('ne demande rien à un batch qui ne tenait pas la règle', () => {
    expect(requiredSlowCookTag([simple, simple], simple)).toBeUndefined();
  });
});

describe('parseDurations', () => {
  it('lit les formes qu’écrit une recette', () => {
    expect(parseDurations('Couvrir et laisser mijoter 2 h 30.')).toEqual([150]);
    expect(parseDurations('Enfourner 1h.')).toEqual([60]);
    expect(parseDurations('Cuire 1 heure 30 à feu doux.')).toEqual([90]);
    expect(parseDurations('Laisser reposer 45 minutes.')).toEqual([45]);
    expect(parseDurations('Mijoter 40 min.')).toEqual([40]);
    expect(parseDurations('Cuire 1h30 puis 10 min à découvert.')).toEqual([90, 10]);
  });

  it('ne prend pas une température ou une quantité pour une durée', () => {
    expect(parseDurations('Préchauffer le four à 180 °C.')).toEqual([]);
    expect(parseDurations('Ajouter 2 huiles et 4 carottes.')).toEqual([]);
  });
});

/**
 * Une fiche annonçait 60 minutes de cuisson seule en disant « mijoter 1 h 30 »
 * dans ses étapes : deux chiffres produits séparément, jamais comparés.
 */
describe('cookTimeViolations', () => {
  it('accepte des étapes qui tiennent dans le temps déclaré', () => {
    expect(cookTimeViolations('Curry', ['Mijoter 1 h 30.'], 90)).toEqual([]);
  });

  it('refuse des étapes plus longues que le temps déclaré, chiffres à l’appui', () => {
    const violations = cookTimeViolations('Bourguignon', ['Mijoter 1 h 30.'], 60);
    expect(violations.map((v) => v.code)).toEqual(['cook-time-mismatch']);
    expect(violations[0]?.message).toContain('1 h 30');
    expect(violations[0]?.message).toContain('60');
  });

  it('tolère un arrondi', () => {
    expect(cookTimeViolations('Chili', ['Mijoter 45 minutes.'], 40)).toEqual([]);
    expect(cookTimeViolations('Chili', ['Mijoter 50 minutes.'], 40)).not.toEqual([]);
  });

  // Faire dorer dix minutes est un geste surveillé, pas une cuisson seule.
  it('ignore les durées courtes', () => {
    expect(cookTimeViolations('Poêlée', ['Faire dorer 10 min.', 'Cuire 20 min.'], 0)).toEqual([]);
  });

  it('s’applique à la génération de la semaine', () => {
    const plan = makeValidGeneratedPlan();
    recipe(plan, 'batch-curry').steps = ['Couvrir et laisser mijoter 2 h.'];

    expect(codes(plan)).toContain('cook-time-mismatch');
  });

  it('s’applique à une recette du week-end', () => {
    const longue = makeGeneratedRecipe({
      slug: 'gratin',
      steps: ['Enfourner 1 h.'],
      cookMinutes: 0,
    });
    expect(validateMealReplacement(longue, 0).map((v) => v.code)).toContain('cook-time-mismatch');
  });
});
