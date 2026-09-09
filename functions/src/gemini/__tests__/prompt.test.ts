import { describe, expect, it } from 'vitest';
import {
  MEAL_REPLACEMENT_SYSTEM_INSTRUCTION,
  PROMPT_VERSION,
  SYSTEM_INSTRUCTION,
  buildMealReplacementPrompt,
  buildPlanPrompt,
  buildRetryPrompt,
} from '../prompt';

/**
 * Le prompt est la seule pièce du système qu'on ne peut pas prouver correcte :
 * ce qu'il produit dépend d'un modèle. Ce qu'on peut fixer, en revanche, c'est
 * ce qu'il contient — et ce qu'il ne doit jamais demander en même temps.
 */

describe('buildPlanPrompt', () => {
  it('nomme la semaine visée', () => {
    const prompt = buildPlanPrompt({ weekStart: '2026-09-14', recentRecipeNames: [] });
    expect(prompt).toContain('2026-09-14');
    expect(prompt).toContain('lundi');
  });

  it('n’encombre pas le prompt de sections vides', () => {
    const prompt = buildPlanPrompt({ weekStart: '2026-09-14', recentRecipeNames: [] });
    expect(prompt).not.toContain('favori');
    expect(prompt).not.toContain('Contraintes particulières');
  });

  it('liste les plats récents comme interdits', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-14',
      recentRecipeNames: ['Curry de lentilles', 'Soupe de poireaux'],
    });
    expect(prompt).toContain('ne les repropose pas');
    expect(prompt).toContain('- Curry de lentilles');
    expect(prompt).toContain('- Soupe de poireaux');
  });

  it('propose les favoris sans les imposer, et un seul au plus', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-14',
      recentRecipeNames: [],
      favoriteRecipeNames: ['Chili sin carne'],
    });
    expect(prompt).toContain('favori');
    expect(prompt).toContain('au maximum');
    expect(prompt).toContain('- Chili sin carne');
  });

  it('reprend les notes de l’utilisateur, débarrassées des espaces', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-14',
      recentRecipeNames: [],
      notes: '  pas de porc  ',
    });
    expect(prompt).toContain('Contraintes particulières');
    expect(prompt).toContain('pas de porc');
    expect(prompt).not.toContain('  pas de porc  ');
  });

  it('ignore des notes vides', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-14',
      recentRecipeNames: [],
      notes: '   ',
    });
    expect(prompt).not.toContain('Contraintes particulières');
  });
});

describe('buildMealReplacementPrompt', () => {
  it('situe le repas dans la semaine et nomme le créneau', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 1,
      slot: 'dinner',
      date: '2026-09-15',
      currentRecipeName: 'Soupe de poireaux',
      otherRecipeNames: ['Curry de lentilles'],
    });

    expect(prompt).toContain('soir');
    expect(prompt).toContain('mardi');
    expect(prompt).toContain('dayIndex 1');
  });

  it('exclut le plat en place et ceux du reste de la semaine', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 1,
      slot: 'lunch',
      date: '2026-09-15',
      currentRecipeName: 'Soupe de poireaux',
      otherRecipeNames: ['Curry de lentilles'],
    });

    expect(prompt).toContain('midi');
    expect(prompt).toContain('Soupe de poireaux');
    expect(prompt).toContain('- Curry de lentilles');
    expect(prompt).toContain('doublon');
  });

  it('tient sans plat en place, quand le créneau était pris dehors', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 5,
      slot: 'dinner',
      date: '2026-09-19',
      currentRecipeName: null,
      otherRecipeNames: [],
    });

    expect(prompt).toContain('samedi');
    expect(prompt).not.toContain('actuellement occupé');
  });
});

describe('buildRetryPrompt', () => {
  it('reprend la demande, les violations et la proposition refusée', () => {
    const prompt = buildRetryPrompt(
      'Établis le plan de la semaine.',
      [{ code: 'weekday-not-one-pot', message: 'jour 2 : « Gratin » doit être one-pot.' }],
      { recipes: [] },
    );

    expect(prompt).toContain('Établis le plan de la semaine.');
    expect(prompt).toContain('- jour 2 : « Gratin » doit être one-pot.');
    expect(prompt).toContain('{"recipes":[]}');
    expect(prompt).toContain('corrige ces points');
  });
});

describe('instructions système', () => {
  it('partagent les exigences de recette sans les recopier', () => {
    // Deux textes qui doivent dire la même chose finissent par diverger : le
    // bloc est partagé, ce test le vérifie plutôt que de l'espérer.
    for (const bloc of ['INGRÉDIENTS', 'ÉTAPES', 'CUISINE']) {
      expect(SYSTEM_INSTRUCTION).toContain(bloc);
      expect(MEAL_REPLACEMENT_SYSTEM_INSTRUCTION).toContain(bloc);
    }
  });

  it('n’imposent la structure de la semaine que là où elle a un sens', () => {
    expect(SYSTEM_INSTRUCTION).toContain('SÉMANTIQUE DES REPAS');
    expect(MEAL_REPLACEMENT_SYSTEM_INSTRUCTION).not.toContain('SÉMANTIQUE DES REPAS');
    expect(MEAL_REPLACEMENT_SYSTEM_INSTRUCTION).toContain('une seule recette');
  });

  it('rappellent la contrainte de semaine dans les deux cas', () => {
    expect(SYSTEM_INSTRUCTION).toContain('one-pot');
    expect(MEAL_REPLACEMENT_SYSTEM_INSTRUCTION).toContain('one-pot');
  });

  it('porte une version, stockée avec chaque plan', () => {
    expect(Number.isInteger(PROMPT_VERSION)).toBe(true);
    expect(PROMPT_VERSION).toBeGreaterThan(0);
  });
});
