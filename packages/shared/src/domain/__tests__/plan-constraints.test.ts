import { describe, expect, it } from 'vitest';
import { describeViolations, validateGeneratedPlan } from '../plan-constraints';
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
    expect(codes(plan)).not.toContain('weekday-too-long'); // le risotto de 60 min est samedi

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
