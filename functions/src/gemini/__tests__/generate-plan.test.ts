import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGeneratedRecipe, makeValidGeneratedPlan } from '../../__tests__/fixtures';
import {
  BatchScheduleGenerationError,
  generateBatchScheduleFromGemini,
} from '../generate-batch-schedule';
import { PlanGenerationError, generateWeeklyPlanFromGemini } from '../generate-plan';
import { MealGenerationError, generateMealRecipeFromGemini } from '../regenerate-meal';

/**
 * La reprise de contenu est bornée à un seul essai — c'est une règle du projet,
 * pas une préférence : chaque tentative consomme le quota du foyer et coûte des
 * jetons. Rien ne la vérifiait jusqu'ici.
 */

const generateJson = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ generateJson }));

const validPlan = makeValidGeneratedPlan;

/** Plan refusé : un plat du batch qui ne produit pas assez de portions. */
function planWithViolation() {
  const plan = validPlan();
  const fautif = plan.recipes.find((recipe) => recipe.slug === 'batch-curry');
  if (fautif) fautif.servings = 2;
  return plan;
}

const promptInput = {
  weekStart: '2026-09-19',
  batchRecipeCount: 3,
  vegetarianCount: 0,
  recentRecipeNames: [],
};

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
      .mockResolvedValueOnce({ data: planWithViolation(), model: 'gemini-test' })
      .mockResolvedValueOnce({ data: validPlan(), model: 'gemini-test' });

    const result = await generateWeeklyPlanFromGemini(promptInput);

    expect(result.attempts).toBe(2);
    expect(generateJson).toHaveBeenCalledTimes(2);

    // La reprise n'est pas une répétition : elle porte les violations, et
    // chiffrées — c'est ce qui rend un seul essai supplémentaire suffisant.
    const secondPrompt: string = generateJson.mock.calls[1]?.[0].prompt;
    expect(secondPrompt).toContain('refusée');
    expect(secondPrompt).toContain('portions');
  });

  it('abandonne après deux essais, jamais trois', async () => {
    generateJson.mockResolvedValue({ data: planWithViolation(), model: 'gemini-test' });

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

  it('refuse un plan qui ne tient pas le nombre de plats végétariens demandé', async () => {
    // Le compte choisi par le foyer passe jusqu'au validateur : sans lui, un
    // plan sans aucun plat végétarien serait accepté.
    generateJson.mockResolvedValue({ data: validPlan(), model: 'gemini-test' });

    await expect(
      generateWeeklyPlanFromGemini({ ...promptInput, vegetarianCount: 1 }),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ code: 'batch-vegetarian-count' }),
      ]),
    });
  });

  it('remonte les violations avec l’erreur, pour les logs', async () => {
    generateJson.mockResolvedValue({ data: planWithViolation(), model: 'gemini-test' });

    await expect(generateWeeklyPlanFromGemini(promptInput)).rejects.toMatchObject({
      violations: expect.arrayContaining([expect.objectContaining({ code: expect.any(String) })]),
    });
  });
});

describe('generateMealRecipeFromGemini', () => {
  const mealInput = {
    dayIndex: 0, // samedi : le seul jour, avec le dimanche, où l'on cuisine
    style: 'one-pot' as const,
    slot: 'dinner' as const,
    date: '2026-09-19',
    currentRecipeName: 'Soupe de poireaux',
    otherRecipeNames: ['Curry de lentilles'],
  };

  const rapide = makeGeneratedRecipe({ slug: 'chili', tags: ['one-pot'], prepMinutes: 30 });
  const longue = makeGeneratedRecipe({ slug: 'gratin', tags: ['healthy'], prepMinutes: 90 });

  it('accepte du premier coup une recette qui convient au style demandé', async () => {
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

  it('laisse passer la même recette quand un plat élaboré est demandé', async () => {
    generateJson.mockResolvedValue({ data: { recipe: longue }, model: 'gemini-test' });

    const result = await generateMealRecipeFromGemini({ ...mealInput, style: 'elaborate' });
    expect(result.attempts).toBe(1);
  });
});

describe('generateBatchScheduleFromGemini', () => {
  const recipes = [
    makeRecipeIngredients('curry', ['oignon']),
    makeRecipeIngredients('chili', ['poivron']),
  ];
  const input = {
    recipes: recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.id,
      cookMinutes: 0,
      ingredients: recipe.ingredients.map((ingredient) => ({ name: ingredient.name, toCut: true })),
      steps: ['Cuire.'],
    })),
  };

  const good = {
    cuts: [{ recipeId: 'curry', ingredient: 'oignon', cut: 'émincé' }],
    steps: [
      { recipeId: 'curry', text: 'Faire revenir l’oignon.' },
      { recipeId: 'chili', text: 'Faire sauter le poivron.' },
    ],
    timings: [
      { recipeId: 'curry', cookMinutes: 0 },
      { recipeId: 'chili', cookMinutes: 0 },
    ],
  };

  it('reprend une fois quand une étape redemande de couper', async () => {
    generateJson
      .mockResolvedValueOnce({
        data: { ...good, steps: [{ recipeId: 'curry', text: 'Émincer l’oignon.' }, good.steps[1]] },
        model: 'gemini-test',
      })
      .mockResolvedValueOnce({ data: good, model: 'gemini-test' });

    const result = await generateBatchScheduleFromGemini(input, recipes);

    expect(result.attempts).toBe(2);
    const secondPrompt: string = generateJson.mock.calls[1]?.[0].prompt;
    expect(secondPrompt).toContain('déjà coupé');
  });

  it('reprend une fois quand le temps annoncé dément les étapes', async () => {
    generateJson
      .mockResolvedValueOnce({
        data: {
          ...good,
          steps: [{ recipeId: 'curry', text: 'Laisser mijoter 1 h 30.' }, good.steps[1]],
        },
        model: 'gemini-test',
      })
      .mockResolvedValueOnce({ data: good, model: 'gemini-test' });

    const result = await generateBatchScheduleFromGemini(input, recipes);

    expect(result.attempts).toBe(2);
    const secondPrompt: string = generateJson.mock.calls[1]?.[0].prompt;
    expect(secondPrompt).toContain('1 h 30');
  });

  it('abandonne après deux essais si un plat reste sans étape', async () => {
    generateJson.mockResolvedValue({
      data: { cuts: [], steps: [good.steps[0]], timings: good.timings },
      model: 'gemini-test',
    });

    await expect(generateBatchScheduleFromGemini(input, recipes)).rejects.toBeInstanceOf(
      BatchScheduleGenerationError,
    );
    expect(generateJson).toHaveBeenCalledTimes(2);
  });
});

function makeRecipeIngredients(id: string, names: string[]) {
  return {
    id,
    name: id,
    ingredients: names.map((name) => ({
      name,
      qty: 1,
      unit: 'piece' as const,
      aisle: 'fruits-legumes' as const,
    })),
  };
}
