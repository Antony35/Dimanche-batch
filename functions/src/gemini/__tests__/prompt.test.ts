import { describe, expect, it } from 'vitest';
import {
  BATCH_SCHEDULE_SYSTEM_INSTRUCTION,
  buildBatchSchedulePrompt,
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
  it('dit combien de plats le foyer veut préparer', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-12',
      batchRecipeCount: 5,
      recentRecipeNames: [],
    });
    expect(prompt).toContain('exactement 5 plats');
  });

  it('nomme la semaine visée, du samedi au vendredi', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-12',
      batchRecipeCount: 3,
      recentRecipeNames: [],
    });
    expect(prompt).toContain('2026-09-12');
    expect(prompt).toContain('2026-09-18');
    expect(prompt).toContain('samedi');
  });

  it('n’encombre pas le prompt de sections vides', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-12',
      batchRecipeCount: 3,
      recentRecipeNames: [],
    });
    expect(prompt).not.toContain('favori');
    expect(prompt).not.toContain('n’en veut plus');
    expect(prompt).not.toContain('Contraintes particulières');
  });

  it('interdit les plats bannis sans réserve, contrairement aux plats récents', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-12',
      batchRecipeCount: 3,
      recentRecipeNames: [],
      bannedRecipeNames: ['Gratin de courgettes', 'Bœuf carottes'],
    });
    expect(prompt).toContain('sous aucun prétexte');
    expect(prompt).toContain('- Gratin de courgettes');
    expect(prompt).toContain('- Bœuf carottes');
  });

  it('liste les plats récents comme interdits', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-12',
      batchRecipeCount: 3,
      recentRecipeNames: ['Curry de lentilles', 'Soupe de poireaux'],
    });
    expect(prompt).toContain('ne les repropose pas');
    expect(prompt).toContain('- Curry de lentilles');
    expect(prompt).toContain('- Soupe de poireaux');
  });

  it('propose les favoris sans les imposer, et un seul au plus', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-12',
      batchRecipeCount: 3,
      recentRecipeNames: [],
      favoriteRecipeNames: ['Chili sin carne'],
    });
    expect(prompt).toContain('favori');
    expect(prompt).toContain('au maximum');
    expect(prompt).toContain('- Chili sin carne');
  });

  it('reprend les notes de l’utilisateur, débarrassées des espaces', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-12',
      batchRecipeCount: 3,
      recentRecipeNames: [],
      notes: '  pas de porc  ',
    });
    expect(prompt).toContain('Contraintes particulières');
    expect(prompt).toContain('pas de porc');
    expect(prompt).not.toContain('  pas de porc  ');
  });

  it('ignore des notes vides', () => {
    const prompt = buildPlanPrompt({
      weekStart: '2026-09-12',
      batchRecipeCount: 3,
      recentRecipeNames: [],
      notes: '   ',
    });
    expect(prompt).not.toContain('Contraintes particulières');
  });
});

describe('buildMealReplacementPrompt', () => {
  it('situe le repas dans la semaine et nomme le créneau', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 3,
      slot: 'dinner',
      date: '2026-09-15',
      currentRecipeName: 'Soupe de poireaux',
      otherRecipeNames: ['Curry de lentilles'],
    });

    expect(prompt).toContain('soir');
    expect(prompt).toContain('mardi');
    expect(prompt).toContain('dayIndex 3');
  });

  it('interdit aussi les plats bannis lors d’un remplacement', () => {
    // Le geste courant : bannir un plat depuis le planning, puis le remplacer.
    // Sans cette section, le modèle pourrait le reproposer aussitôt.
    const prompt = buildMealReplacementPrompt({
      dayIndex: 3,
      slot: 'lunch',
      date: '2026-09-15',
      currentRecipeName: 'Gratin de courgettes',
      otherRecipeNames: [],
      bannedRecipeNames: ['Gratin de courgettes'],
    });

    expect(prompt).toContain('sous aucun prétexte');
    expect(prompt).toContain('- Gratin de courgettes');
  });

  it('exclut le plat en place et ceux du reste de la semaine', () => {
    const prompt = buildMealReplacementPrompt({
      dayIndex: 3,
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
      dayIndex: 0,
      slot: 'dinner',
      date: '2026-09-12',
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

  it('ne demandent le one-pot que pour un remplacement', () => {
    // Composer la semaine n'a plus besoin de plats rapides : tout est cuisiné
    // le dimanche. Seul un repas remplacé en pleine semaine se cuisine le soir
    // même, et c'est là, et seulement là, que la contrainte garde un sens.
    expect(SYSTEM_INSTRUCTION).not.toContain('one-pot');
    expect(MEAL_REPLACEMENT_SYSTEM_INSTRUCTION).toContain('one-pot');
  });

  it('dit que la semaine ne se cuisine pas', () => {
    expect(SYSTEM_INSTRUCTION).toContain('ON NE CUISINE PAS');
    expect(SYSTEM_INSTRUCTION).toContain('SAMEDI au VENDREDI');
  });

  /**
   * Régression : l'instruction de remplacement a longtemps dit « du lundi au
   * vendredi (dayIndex 0 à 4) », l'ancienne numérotation d'avant la semaine du
   * samedi. Le modèle recevait donc samedi et dimanche comme jours contraints,
   * et jeudi et vendredi comme libres, pendant que `isWeekday` disait 2 à 6.
   * La reprise de contenu masquait l'écart en gâchant une génération.
   */
  it('donnent au modèle la même numérotation des jours que le domaine', () => {
    for (const instruction of [SYSTEM_INSTRUCTION, MEAL_REPLACEMENT_SYSTEM_INSTRUCTION]) {
      expect(instruction).toContain('0 samedi');
      expect(instruction).toContain('6 vendredi');
      expect(instruction).not.toContain('dayIndex 0 à 4');
    }
    // Les jours contraints sont ceux que `isWeekday` couvre : 2 à 6.
    expect(MEAL_REPLACEMENT_SYSTEM_INSTRUCTION).toContain('dayIndex 2 à 6');
  });

  it('demande les plats du batch dans l’ordre de préparation', () => {
    // C'est cet ordre que suit l'écran de préparation du dimanche : sans lui,
    // il faudrait un champ de plus dans le contrat.
    expect(SYSTEM_INSTRUCTION).toContain("DANS L'ORDRE");
  });

  it('porte une version, stockée avec chaque plan', () => {
    expect(Number.isInteger(PROMPT_VERSION)).toBe(true);
    expect(PROMPT_VERSION).toBeGreaterThan(0);
  });
});

describe('buildBatchSchedulePrompt', () => {
  const prompt = buildBatchSchedulePrompt({
    recipes: [
      { id: 'curry', name: 'Curry', prepMinutes: 50, steps: ['Émincer l’oignon.', 'Mijoter.'] },
      { id: 'chili', name: 'Chili', prepMinutes: 40, steps: ['Hacher l’oignon.'] },
    ],
  });

  // Le modèle doit citer ces identifiants dans recipeIds : sans eux dans le
  // prompt, il inventerait des noms que le validateur refuserait.
  it('donne chaque plat avec son identifiant exact', () => {
    expect(prompt).toContain('identifiant curry');
    expect(prompt).toContain('identifiant chili');
  });

  it('numérote les étapes de chaque recette', () => {
    expect(prompt).toContain('1. Émincer l’oignon.');
    expect(prompt).toContain('2. Mijoter.');
  });

  it('interdit de perdre une étape, la faute que le validateur guette', () => {
    expect(BATCH_SCHEDULE_SYSTEM_INSTRUCTION).toContain('Ne perds aucune étape');
  });
});
