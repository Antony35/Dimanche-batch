import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGeneratedPlan, makeGeneratedRecipe } from '../../__tests__/fixtures';
import { PlanGenerationError, generateWeeklyPlanFromGemini } from '../generate-plan';
import { MealGenerationError, generateMealRecipeFromGemini } from '../regenerate-meal';

/**
 * La reprise de contenu est bornée à un seul essai — c'est une règle du projet,
 * pas une préférence : chaque tentative consomme le quota du foyer et coûte des
 * jetons. Rien ne la vérifiait jusqu'ici.
 */

const generateJson = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ generateJson }));



/** Plan conforme aux contraintes de la semaine type. */
function validPlan() {
  const recipes = [
    makeGeneratedRecipe({ slug: 'batch-curry', tags: ['one-pot', 'batch'] }),
    makeGeneratedRecipe({ slug: 'soupe-poireaux', tags: ['one-pot', 'congelable'] }),
    makeGeneratedRecipe({ slug: 'chili-sin-carne', tags: ['one-pot', 'congelable'] }),
  ];
  return makeGeneratedPlan(recipes);
}

/** Plan refusé : un plat de deux heures, non one-pot, un mardi soir. */
function planWithWeekdayViolation() {
  const plan = validPlan();
  const fautive = plan.recipes.find((recipe) => recipe.slug === 'soupe-poireaux');
  if (fautive) {
    fautive.tags = ['weekend'];
    fautive.prepMinutes = 120;
  }
  return plan;
}

const promptInput = { weekStart: '2026-09-12', recentRecipeNames: [] };

beforeEach(() => {
  generateJson.mockReset();
});

describe('generateWeeklyPlanFromGemini', () => {
  it('n’appelle le modèle qu’une fois quand le premier plan convient', async () => {
    generateJson.mockResolvedValue({ data: validPlan(), model: 'gemini-test' });

    const result = await generateWeeklyPlanFromGemini(promptInput);

    expect(result.attempts).toBe(1);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it('reprend une fois, en disant au modèle ce qui n’allait pas', async () => {
    generateJson
      .mockResolvedValueOnce({ data: planWithWeekdayViolation(), model: 'gemini-test' })
      .mockResolvedValueOnce({ data: validPlan(), model: 'gemini-test' });

    const result = await generateWeeklyPlanFromGemini(promptInput);

    expect(result.attempts).toBe(2);
    expect(generateJson).toHaveBeenCalledTimes(2);

    // La reprise n'est pas une répétition : elle porte les violations.
    const secondPrompt: string = generateJson.mock.calls[1]?.[0].prompt;
    expect(secondPrompt).toContain('refusée');
    expect(secondPrompt).toContain('one-pot');
  });

  it('abandonne après deux essais, jamais trois', async () => {
    generateJson.mockResolvedValue({ data: planWithWeekdayViolation(), model: 'gemini-test' });

    await expect(generateWeeklyPlanFromGemini(promptInput)).rejects.toBeInstanceOf(
      PlanGenerationError,
    );
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it('reprend aussi sur une réponse hors schéma', async () => {
    generateJson
      .mockResolvedValueOnce({ data: { recipes: 'pas un tableau' }, model: 'gemini-test' })
      .mockResolvedValueOnce({ data: validPlan(), model: 'gemini-test' });

    const result = await generateWeeklyPlanFromGemini(promptInput);
    expect(result.attempts).toBe(2);
  });

  it('remonte les violations avec l’erreur, pour les logs', async () => {
    generateJson.mockResolvedValue({ data: planWithWeekdayViolation(), model: 'gemini-test' });

    await expect(generateWeeklyPlanFromGemini(promptInput)).rejects.toMatchObject({
      violations: expect.arrayContaining([expect.objectContaining({ code: expect.any(String) })]),
    });
  });
});

describe('generateMealRecipeFromGemini', () => {
  const mealInput = {
    dayIndex: 3, // mardi : la contrainte de semaine s'y applique
    slot: 'dinner' as const,
    date: '2026-09-15',
    currentRecipeName: 'Soupe de poireaux',
    otherRecipeNames: ['Curry de lentilles'],
  };

  const rapide = makeGeneratedRecipe({ slug: 'chili', tags: ['one-pot'], prepMinutes: 30 });
  const longue = makeGeneratedRecipe({ slug: 'gratin', tags: ['weekend'], prepMinutes: 90 });

  it('accepte du premier coup une recette qui convient au jour', async () => {
    generateJson.mockResolvedValue({ data: { recipe: rapide }, model: 'gemini-test' });

    const result = await generateMealRecipeFromGemini(mealInput);

    expect(result.attempts).toBe(1);
    expect(result.recipe.slug).toBe('chili');
  });

  it('abandonne après deux essais, jamais trois', async () => {
    generateJson.mockResolvedValue({ data: { recipe: longue }, model: 'gemini-test' });

    await expect(generateMealRecipeFromGemini(mealInput)).rejects.toBeInstanceOf(
      MealGenerationError,
    );
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it('laisse passer la même recette le week-end', async () => {
    generateJson.mockResolvedValue({ data: { recipe: longue }, model: 'gemini-test' });

    // 0 = samedi : on cuisine le jour même, sans contrainte de rapidité.
    const result = await generateMealRecipeFromGemini({ ...mealInput, dayIndex: 0 });
    expect(result.attempts).toBe(1);
  });
});
