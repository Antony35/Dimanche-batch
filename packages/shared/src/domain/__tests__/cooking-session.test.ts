import { describe, expect, it } from 'vitest';
import {
  isCookingSessionCurrent,
  orderCookingSession,
  sessionCookMinutes,
  validateCookingSession,
} from '../cooking-session';
import { makePlan, makeRecipe } from './fixtures';

/**
 * Une fois tout coupé, la session ne garde de chaque plat que sa cuisson. Ce
 * qu'elle ne doit jamais faire : perdre un plat, redemander de couper, ou
 * inventer une découpe pour un ingrédient absent.
 */
const curry = makeRecipe({
  id: 'curry',
  ingredients: [
    { name: 'oignon', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
    { name: 'lentilles corail', qty: 300, unit: 'g', aisle: 'epicerie' },
  ],
});
const chili = makeRecipe({
  id: 'chili',
  ingredients: [{ name: 'poivron', qty: 2, unit: 'piece', aisle: 'fruits-legumes' }],
});
const RECIPES = [curry, chili];

/** Un temps de cuisson par plat : ce qu'une session complète rend. */
const TIMINGS = [
  { recipeId: 'curry', cookMinutes: 20 },
  { recipeId: 'chili', cookMinutes: 0 },
];

const step = (recipeId: string, text: string) => ({ recipeId, text });
const cut = (recipeId: string, ingredient: string, how: string) => ({
  recipeId,
  ingredient,
  cut: how,
});

function codes(session: {
  cuts: ReturnType<typeof cut>[];
  steps: ReturnType<typeof step>[];
  timings?: { recipeId: string; cookMinutes: number }[];
}) {
  return validateCookingSession({ timings: TIMINGS, ...session }, RECIPES).map(
    (violation) => violation.code,
  );
}

describe('validateCookingSession', () => {
  it('accepte une session qui donne des étapes à chaque plat', () => {
    expect(
      codes({
        cuts: [cut('curry', 'oignon', 'émincé'), cut('chili', 'Poivron', 'en lanières')],
        steps: [
          step('curry', 'Faire revenir les oignons émincés.'),
          step('curry', 'Ajouter les lentilles et cuire 20 minutes.'),
          step('chili', 'Faire sauter les poivrons.'),
        ],
      }),
    ).toEqual([]);
  });

  it('refuse une session qui oublie un plat', () => {
    expect(codes({ cuts: [], steps: [step('curry', 'Cuire.')] })).toEqual([
      'session-missing-recipe',
    ]);
  });

  it('refuse une étape ou une découpe qui vise un plat hors du batch', () => {
    const result = codes({
      cuts: [cut('gratin', 'courgette', 'en rondelles')],
      steps: [step('curry', 'Cuire.'), step('chili', 'Cuire.'), step('gratin', 'Enfourner.')],
    });
    expect(result).toEqual(['session-unknown-recipe', 'session-unknown-recipe']);
  });

  // Tout est coupé à ce stade : une étape qui redemande de couper n'a pas été réécrite.
  it('refuse une étape qui commence par une découpe', () => {
    const result = codes({
      cuts: [],
      steps: [step('curry', 'Émincer l’oignon et le faire revenir.'), step('chili', 'Cuire.')],
    });
    expect(result).toEqual(['session-prep-step']);
  });

  it('laisse passer une étape qui ne fait que citer un ingrédient coupé', () => {
    expect(
      codes({
        cuts: [],
        steps: [step('curry', 'Ajouter les oignons émincés.'), step('chili', 'Cuire.')],
      }),
    ).toEqual([]);
  });

  it('refuse la découpe d’un ingrédient que la recette ne contient pas', () => {
    const violations = validateCookingSession(
      {
        cuts: [cut('curry', 'échalote', 'ciselée')],
        steps: [step('curry', 'Cuire.'), step('chili', 'Cuire.')],
        timings: TIMINGS,
      },
      RECIPES,
    );
    expect(violations.map((violation) => violation.code)).toEqual(['session-unknown-ingredient']);
    expect(violations[0]?.message).toContain('nom exact');
  });
});

/**
 * L'écran annonçait un temps de cuisson que les étapes démentaient. La session
 * rend désormais le sien, et il doit concorder avec ses propres étapes.
 */
describe('validateCookingSession, temps de cuisson', () => {
  it('exige un temps pour chaque plat', () => {
    expect(
      codes({
        cuts: [],
        steps: [step('curry', 'Cuire.'), step('chili', 'Cuire.')],
        timings: [{ recipeId: 'curry', cookMinutes: 20 }],
      }),
    ).toEqual(['session-missing-timing']);
  });

  it('refuse un temps que les étapes démentent', () => {
    expect(
      codes({
        cuts: [],
        steps: [step('curry', 'Couvrir et laisser mijoter 1 h 30.'), step('chili', 'Cuire.')],
      }),
    ).toEqual(['cook-time-mismatch']);
  });

  it('préfère le temps de la session à celui de la recette, et retombe dessus à défaut', () => {
    const recipe = { id: 'curry', cookMinutes: 60 };
    expect(sessionCookMinutes({ timings: [{ recipeId: 'curry', cookMinutes: 90 }] }, recipe)).toBe(
      90,
    );
    expect(sessionCookMinutes({ timings: [] }, recipe)).toBe(60);
    expect(sessionCookMinutes(null, recipe)).toBe(60);
  });
});

describe('isCookingSessionCurrent', () => {
  const session = {
    id: '2026-09-12',
    sourceRecipeIds: ['curry', 'chili'],
    cuts: [],
    timings: TIMINGS,
    steps: [step('curry', 'Cuire.')],
    generatedAt: 0,
    generatedBy: 'uid',
    model: 'gemini-test',
    promptVersion: 9,
  };

  it('reconnaît une session composée pour ce batch', () => {
    expect(isCookingSessionCurrent(session, makePlan([], '2026-09-12', ['curry', 'chili']))).toBe(
      true,
    );
  });

  it('signale une session périmée par un plat remplacé', () => {
    expect(isCookingSessionCurrent(session, makePlan([], '2026-09-12', ['curry', 'tajine']))).toBe(
      false,
    );
  });

  it('signale une session dont l’ordre du batch a changé', () => {
    expect(isCookingSessionCurrent(session, makePlan([], '2026-09-12', ['chili', 'curry']))).toBe(
      false,
    );
  });
});

describe('orderCookingSession', () => {
  it('ordonne et annonce selon le temps de la session, pas celui de la recette', () => {
    const entries = [
      { recipe: makeRecipe({ id: 'curry', cookMinutes: 120 }) },
      { recipe: makeRecipe({ id: 'chili', cookMinutes: 10 }) },
    ];
    const ordered = orderCookingSession(entries, {
      timings: [
        { recipeId: 'curry', cookMinutes: 20 },
        { recipeId: 'chili', cookMinutes: 90 },
      ],
    });
    expect(ordered.map((entry) => [entry.recipe.id, entry.recipe.cookMinutes])).toEqual([
      ['chili', 90],
      ['curry', 20],
    ]);
  });

  it('retombe sur la recette sans session', () => {
    const entries = [
      { recipe: makeRecipe({ id: 'curry', cookMinutes: 30 }) },
      { recipe: makeRecipe({ id: 'chili', cookMinutes: 60 }) },
    ];
    expect(orderCookingSession(entries, null).map((entry) => entry.recipe.id)).toEqual([
      'chili',
      'curry',
    ]);
  });
});
