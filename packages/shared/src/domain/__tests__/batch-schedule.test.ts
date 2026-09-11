import { describe, expect, it } from 'vitest';
import { isScheduleCurrent, validateBatchSchedule } from '../batch-schedule';
import { makePlan } from './fixtures';

/**
 * Le déroulé fond plusieurs recettes en une séquence. Ce qu'il ne doit jamais
 * faire, c'est en perdre une en route : on s'en apercevrait devant les
 * fourneaux, avec un plat jamais cuisiné.
 */
const BATCH = ['curry', 'chili', 'soupe'];

const step = (text: string, ...recipeIds: string[]) => ({ text, recipeIds });

describe('validateBatchSchedule', () => {
  const codes = (steps: ReturnType<typeof step>[]) =>
    validateBatchSchedule({ steps }, BATCH).map((violation) => violation.code);

  it('accepte un déroulé qui couvre chaque plat', () => {
    expect(
      codes([
        step('Éplucher les oignons des trois plats.', 'curry', 'chili', 'soupe'),
        step('Lancer le chili à feu doux.', 'chili'),
        step('Pendant ce temps, préparer le curry.', 'curry'),
      ]),
    ).toEqual([]);
  });

  it('refuse un déroulé qui oublie un plat', () => {
    const result = codes([
      step('Préparer le curry.', 'curry'),
      step('Préparer le chili.', 'chili'),
    ]);
    expect(result).toEqual(['schedule-missing-recipe']);
  });

  it('refuse une étape qui vise un plat hors du batch', () => {
    const result = codes([
      step('Préparer tout.', 'curry', 'chili', 'soupe'),
      step('Faire le gratin.', 'gratin'),
    ]);
    expect(result).toEqual(['schedule-unknown-recipe']);
  });

  it('nomme le plat oublié, puisque le message repart dans la reprise', () => {
    const [violation] = validateBatchSchedule(
      { steps: [step('Tout sauf la soupe.', 'curry', 'chili')] },
      BATCH,
    );
    expect(violation?.message).toContain('soupe');
  });
});

describe('isScheduleCurrent', () => {
  const plan = makePlan([], '2026-09-12', BATCH);
  const schedule = (sourceRecipeIds: string[]) => ({
    id: '2026-09-12',
    sourceRecipeIds,
    steps: [],
    generatedAt: 0,
    generatedBy: 'uid',
    model: 'gemini-test',
    promptVersion: 1,
  });

  it('reconnaît un déroulé composé à partir du batch actuel', () => {
    expect(isScheduleCurrent(schedule(BATCH), plan)).toBe(true);
  });

  // Le cas qui motive la fonction : un plat remplacé depuis l'écran du batch.
  it('déclare périmé un déroulé dont un plat a été remplacé', () => {
    expect(isScheduleCurrent(schedule(['curry', 'tajine', 'soupe']), plan)).toBe(false);
  });

  it('déclare périmé un déroulé composé pour un batch plus court', () => {
    expect(isScheduleCurrent(schedule(['curry', 'chili']), plan)).toBe(false);
  });
});
