import { describe, expect, it } from 'vitest';
import {
  describeViolations,
  validateGeneratedPlan,
  validateMealReplacement,
} from '../plan-constraints';
import { makeGeneratedRecipe, makeValidGeneratedPlan } from './fixtures';

function codes(plan: ReturnType<typeof makeValidGeneratedPlan>): string[] {
  return validateGeneratedPlan(plan).map((violation) => violation.code);
}

describe('validateGeneratedPlan', () => {
  it('accepte un plan conforme à la semaine type', () => {
    expect(validateGeneratedPlan(makeValidGeneratedPlan())).toEqual([]);
  });

  it('refuse un plat qui n’est pas one-pot un soir de semaine', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes = plan.recipes.map((recipe) =>
      recipe.slug === 'chili-sin-carne' ? { ...recipe, tags: ['healthy', 'congelable'] } : recipe,
    );
    expect(codes(plan)).toContain('weekday-not-one-pot');
  });

  it('tolère une recette longue le week-end mais pas en semaine', () => {
    const plan = makeValidGeneratedPlan();
    expect(codes(plan)).not.toContain('weekday-too-long'); // le risotto de 60 min est samedi (0)

    plan.recipes = plan.recipes.map((recipe) =>
      recipe.slug === 'soupe-poireaux' ? { ...recipe, prepMinutes: 90 } : recipe,
    );
    expect(codes(plan)).toContain('weekday-too-long');
  });

  it('exige au moins deux recettes congelables', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes = plan.recipes.map((recipe) => ({
      ...recipe,
      tags: recipe.tags.filter((tag) => tag !== 'congelable'),
    }));
    expect(codes(plan)).toContain('not-enough-freezable');
  });

  it('exige trois recettes cuisinées distinctes', () => {
    const plan = makeValidGeneratedPlan();
    plan.days = plan.days.map((day) => ({
      ...day,
      dinner: { ...day.dinner, recipeSlug: 'soupe-poireaux' },
    }));
    expect(codes(plan)).toContain('not-enough-variety');
  });

  it('signale une recette déclarée mais jamais servie', () => {
    const plan = makeValidGeneratedPlan();
    plan.recipes = [...plan.recipes, makeGeneratedRecipe({ slug: 'orpheline' })];
    expect(codes(plan)).toContain('orphan-recipe');
  });

  it('signale une référence vers une recette inexistante', () => {
    const plan = makeValidGeneratedPlan();
    plan.days[0]!.dinner.recipeSlug = 'fantome';
    expect(codes(plan)).toContain('unknown-slug');
  });

  it('n’accepte un repas sans recette que pour un repas pris dehors', () => {
    const plan = makeValidGeneratedPlan();
    plan.days[5]!.dinner = { recipeSlug: null, kind: 'cooked', withStarter: false, withDessert: false };
    expect(codes(plan)).toContain('missing-recipe');

    plan.days[5]!.dinner.kind = 'eat-out';
    expect(codes(plan)).not.toContain('missing-recipe');
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

  it('refuse des jours en double', () => {
    const plan = makeValidGeneratedPlan();
    plan.days[6]!.dayIndex = 5;
    expect(codes(plan)).toContain('day-index');
  });
});

describe('describeViolations', () => {
  it('rend une puce par violation, prête à réinjecter dans le prompt', () => {
    // Ce texte part tel quel au modèle lors de l’unique retry : s’il perd une
    // violation en route, la reprise corrige à l’aveugle.
    const plan = makeValidGeneratedPlan();
    // `chili-sin-carne` est servi les mardi, mercredi et jeudi soir : deux
    // heures de préparation y sont hors contrainte.
    const enSemaine = plan.recipes.find((recipe) => recipe.slug === 'chili-sin-carne');
    enSemaine!.prepMinutes = 120;
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

describe('validateMealReplacement', () => {
  const rapide = makeGeneratedRecipe({ slug: 'chili', tags: ['one-pot'], prepMinutes: 30 });
  const longue = makeGeneratedRecipe({ slug: 'gratin', tags: ['weekend'], prepMinutes: 90 });

  it('accepte une recette one-pot et rapide un soir de semaine', () => {
    // 2 = lundi, 6 = vendredi : les jours normalement nourris par le batch.
    expect(validateMealReplacement(rapide, 2)).toEqual([]);
    expect(validateMealReplacement(rapide, 6)).toEqual([]);
  });

  it('refuse un plat long ou non one-pot en semaine', () => {
    const codes = validateMealReplacement(longue, 3).map((violation) => violation.code);
    expect(codes).toContain('weekday-not-one-pot');
    expect(codes).toContain('weekday-too-long');
  });

  it('laisse passer le même plat le week-end', () => {
    // 0 = samedi, 1 = dimanche : on cuisine le jour même, sans contrainte.
    expect(validateMealReplacement(longue, 0)).toEqual([]);
    expect(validateMealReplacement(longue, 1)).toEqual([]);
  });

  it('ne vérifie pas les contraintes d’ensemble de la semaine', () => {
    // Un remplacement ne connaît pas le reste du plan : exiger ici deux
    // recettes congelables refuserait tout remplacement d’une seule recette.
    expect(validateMealReplacement(rapide, 4)).toEqual([]);
  });

  it('refuse un jour hors de la semaine', () => {
    expect(validateMealReplacement(rapide, 7).map((v) => v.code)).toEqual(['day-index']);
  });
});
