import { describe, expect, it } from 'vitest';
import {
  MAX_BATCH_TOTAL_MINUTES,
  describeViolations,
  validateGeneratedPlan,
  validateMealReplacement,
} from '../plan-constraints';
import { makeGeneratedRecipe, makeValidGeneratedPlan } from './fixtures';

function codes(plan: ReturnType<typeof makeValidGeneratedPlan>, expected?: number): string[] {
  return validateGeneratedPlan(plan, expected).map((violation) => violation.code);
}

describe('validateGeneratedPlan', () => {
  it('accepte un plan conforme à la semaine type', () => {
    expect(validateGeneratedPlan(makeValidGeneratedPlan())).toEqual([]);
  });

  it('refuse un plat cuisiné un jour de semaine', () => {
    // Le principe même de l'app : on ne cuisine pas du lundi au vendredi.
    const plan = makeValidGeneratedPlan();
    const mardi = plan.days.find((day) => day.dayIndex === 3);
    if (mardi) mardi.dinner = { ...mardi.dinner, recipeSlug: 'risotto-weekend', kind: 'cooked' };

    expect(codes(plan)).toContain('weekday-cooked');
  });

  it('laisse cuisiner le samedi et le dimanche', () => {
    expect(validateGeneratedPlan(makeValidGeneratedPlan())).toEqual([]);
  });

  it('refuse une portion servie depuis un plat hors du batch', () => {
    const plan = makeValidGeneratedPlan();
    const lundi = plan.days.find((day) => day.dayIndex === 2);
    if (lundi) lundi.lunch = { ...lundi.lunch, recipeSlug: 'risotto-weekend' };

    expect(codes(plan)).toContain('leftover-not-from-batch');
  });

  it('refuse qu’un plat du batch soit servi comme plat cuisiné', () => {
    // Il serait alors compté deux fois dans la liste de courses.
    const plan = makeValidGeneratedPlan();
    const samedi = plan.days.find((day) => day.dayIndex === 0);
    if (samedi) samedi.dinner = { ...samedi.dinner, recipeSlug: 'batch-curry' };

    expect(codes(plan)).toContain('cooked-is-batch-recipe');
  });

  it('exige un batch d’au moins trois plats', () => {
    const plan = makeValidGeneratedPlan();
    plan.batchRecipeSlugs = ['batch-curry', 'chili-sin-carne'];

    expect(codes(plan)).toContain('batch-size');
  });

  it('exige exactement le nombre de plats demandé par le foyer', () => {
    const plan = makeValidGeneratedPlan();
    const violations = validateGeneratedPlan(plan, 5);

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

  it('exige assez de portions pour tous les repas servis', () => {
    // Le curry sert quatre repas, soit huit portions pour deux personnes.
    const plan = makeValidGeneratedPlan();
    const curry = plan.recipes.find((recipe) => recipe.slug === 'batch-curry');
    if (curry) curry.servings = 4;

    const violations = validateGeneratedPlan(plan);
    expect(violations.map((v) => v.code)).toContain('batch-servings-short');
    // Le message est chiffré : c'est ce qui rend une seule reprise suffisante.
    const message = violations.find((v) => v.code === 'batch-servings-short')?.message ?? '';
    expect(message).toContain('4 repas');
    expect(message).toContain('8 portions');
  });

  it('accepte des portions justes au compte exact', () => {
    const plan = makeValidGeneratedPlan();
    const soupe = plan.recipes.find((recipe) => recipe.slug === 'soupe-poireaux');
    if (soupe) soupe.servings = 4; // sert deux repas, soit quatre portions

    expect(codes(plan)).not.toContain('batch-servings-short');
  });

  it('exige que les plats de fin de semaine se congèlent', () => {
    // Cuisiné dimanche, mangé vendredi : cinq jours au frigo.
    const plan = makeValidGeneratedPlan();
    plan.recipes = plan.recipes.map((recipe) =>
      recipe.slug === 'soupe-poireaux'
        ? { ...recipe, tags: recipe.tags.filter((tag) => tag !== 'congelable') }
        : recipe,
    );

    expect(codes(plan)).toContain('batch-not-freezable');
  });

  it('n’exige rien de tel d’un plat servi en début de semaine', () => {
    // Le curry est servi lundi et mardi : deux jours au frigo, pas besoin.
    const plan = makeValidGeneratedPlan();
    expect(codes(plan)).not.toContain('batch-not-freezable');
  });

  it('refuse un batch qui ne tient pas dans un après-midi', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes = plan.recipes.map((recipe) =>
      plan.batchRecipeSlugs.includes(recipe.slug) ? { ...recipe, prepMinutes: 120 } : recipe,
    );

    const violations = validateGeneratedPlan(plan);
    expect(violations.map((v) => v.code)).toContain('batch-too-long');
    expect(violations.find((v) => v.code === 'batch-too-long')?.message).toContain(
      String(MAX_BATCH_TOTAL_MINUTES),
    );
  });

  it('signale une recette déclarée mais jamais servie', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes = [...plan.recipes, makeGeneratedRecipe({ slug: 'jamais-servie' })];

    expect(codes(plan)).toContain('orphan-recipe');
  });

  it('signale une référence vers une recette inexistante', () => {
    const plan = makeValidGeneratedPlan();
    const samedi = plan.days.find((day) => day.dayIndex === 0);
    if (samedi) samedi.dinner = { ...samedi.dinner, recipeSlug: 'inconnue' };

    expect(codes(plan)).toContain('unknown-slug');
  });

  it('n’accepte un repas sans recette que pour un repas pris dehors', () => {
    const plan = makeValidGeneratedPlan();
    const samedi = plan.days.find((day) => day.dayIndex === 0);
    if (samedi) samedi.dinner = { ...samedi.dinner, recipeSlug: null, kind: 'cooked' };

    expect(codes(plan)).toContain('missing-recipe');
  });

  it('refuse des jours en double', () => {
    const plan = makeValidGeneratedPlan();
    plan.days = [...plan.days.slice(0, 6), { ...plan.days[0]! }];

    expect(codes(plan)).toContain('day-index');
  });

  it('refuse deux recettes portant le même slug', () => {
    // Le slug devient l'identifiant du document : deux recettes homonymes
    // n'en écriraient qu'une, et le plan citerait la mauvaise.
    const plan = makeValidGeneratedPlan();
    const premiere = plan.recipes[0];
    const seconde = plan.recipes[1];
    if (premiere && seconde) seconde.slug = premiere.slug;

    expect(codes(plan)).toContain('duplicate-slug');
  });
});

describe('validateMealReplacement', () => {
  const rapide = makeGeneratedRecipe({ slug: 'chili', tags: ['one-pot'], prepMinutes: 30 });
  const longue = makeGeneratedRecipe({ slug: 'gratin', tags: ['weekend'], prepMinutes: 90 });

  it('accepte une recette one-pot et rapide un soir de semaine', () => {
    // 2 = lundi, 6 = vendredi : les jours normalement nourris par le batch.
    expect(validateMealReplacement(rapide, 2)).toEqual([]);
    expect(validateMealReplacement(rapide, 6)).toEqual([]);
  });

  it('refuse un plat long ou non one-pot en semaine', () => {
    // C'est le seul endroit où la contrainte one-pot survit : remplacer un
    // repas de semaine oblige à cuisiner le soir même.
    const violations = validateMealReplacement(longue, 3).map((v) => v.code);
    expect(violations).toContain('weekday-not-one-pot');
    expect(violations).toContain('weekday-too-long');
  });

  it('laisse passer le même plat le week-end', () => {
    // 0 = samedi, 1 = dimanche : on cuisine le jour même, sans contrainte.
    expect(validateMealReplacement(longue, 0)).toEqual([]);
    expect(validateMealReplacement(longue, 1)).toEqual([]);
  });

  it('ne vérifie pas les contraintes d’ensemble de la semaine', () => {
    // Un remplacement ne connaît pas le reste du plan : exiger ici la taille du
    // batch ou les portions refuserait tout remplacement.
    expect(validateMealReplacement(rapide, 4)).toEqual([]);
  });

  it('refuse un jour hors de la semaine', () => {
    expect(validateMealReplacement(rapide, 7).map((v) => v.code)).toEqual(['day-index']);
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
