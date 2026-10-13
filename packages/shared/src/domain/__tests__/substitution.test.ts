import { describe, expect, it } from 'vitest';
import {
  SubstitutionError,
  matchesSubstituteQuery,
  substituteCandidates,
  substituteCategory,
  substituteIngredientInRecipe,
  substitutionProblem,
  type SubstituteCandidate,
} from '../substitution';
import type { Recipe } from '../../schemas/recipe';
import { makeRecipe } from './fixtures';

const ratatouille = makeRecipe({
  id: 'ratatouille',
  ingredients: [
    { name: 'courgette', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
    { name: 'oignon', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
    { name: 'poulet', qty: 400, unit: 'g', aisle: 'boucherie' },
    { name: 'riz', qty: 200, unit: 'g', aisle: 'epicerie' },
    { name: "huile d'olive", qty: 2, unit: 'cas', aisle: 'epicerie' },
  ],
});

function names(ingredient: { name: string; aisle: Parameters<typeof substituteCategory>[1] }) {
  return substituteCandidates(ingredient, ratatouille).map((candidate) => candidate.name);
}

describe('catégorie de remplacement', () => {
  it('découpe un rayon plus finement que la liste de courses', () => {
    expect(substituteCategory('courgette', 'fruits-legumes')).toBe('legume');
    expect(substituteCategory('fraise', 'fruits-legumes')).toBe('fruit');
    expect(substituteCategory('oignon rouge', 'fruits-legumes')).toBe('aromate');
    expect(substituteCategory('persil', 'fruits-legumes')).toBe('herbe');
    expect(substituteCategory('lardon', 'boucherie')).toBe('charcuterie');
    expect(substituteCategory('bœuf', 'boucherie')).toBe('viande');
    expect(substituteCategory('moule', 'poissonnerie')).toBe('fruits-de-mer');
    expect(substituteCategory('cabillaud', 'poissonnerie')).toBe('poisson');
    expect(substituteCategory('cumin', 'epicerie')).toBe('epice');
  });

  it('réunit les féculents de deux rayons', () => {
    expect(substituteCategory('pomme de terre', 'fruits-legumes')).toBe('feculent');
    expect(substituteCategory('riz basmati', 'epicerie')).toBe('feculent');
  });

  // Le groupe de mots le plus long gagne, comme pour les rayons.
  it('ne prend pas une pomme de terre pour une pomme', () => {
    expect(substituteCategory('pommes de terre', 'fruits-legumes')).toBe('feculent');
    expect(substituteCategory('pommes', 'fruits-legumes')).toBe('fruit');
  });

  it('ne reconnaît un membre que dans son rayon', () => {
    // « pomme » est un fruit au frais, pas dans un chausson de la boulangerie.
    expect(substituteCategory('chausson aux pommes', 'boulangerie')).toBe('pain');
    expect(substituteCategory('beurre de cacahuète', 'epicerie')).toBe('fruit-sec');
  });

  it('ne remplace pas un produit ménager', () => {
    expect(substituteCategory('éponge', 'entretien')).toBeNull();
  });
});

describe('remplaçants proposés', () => {
  it('proposent légume pour légume', () => {
    const legumes = names(ratatouille.ingredients[0]!);
    expect(legumes).toContain('aubergine');
    expect(legumes).toContain('poivron');
    expect(legumes).not.toContain('fraise');
    expect(legumes).not.toContain('persil');
    expect(legumes).not.toContain('oignon');
  });

  it('proposent viande pour viande, sans charcuterie ni poisson', () => {
    const viandes = names(ratatouille.ingredients[2]!);
    expect(viandes).toContain('dinde');
    expect(viandes).toContain('bœuf');
    expect(viandes).not.toContain('lardon');
    expect(viandes).not.toContain('cabillaud');
  });

  it('écartent l’ingrédient lui-même et ce que la recette contient déjà', () => {
    expect(names(ratatouille.ingredients[0]!)).not.toContain('courgette');
    // Le riz est déjà dans la recette : il ne remplace pas la pomme de terre.
    expect(names({ name: 'pomme de terre', aisle: 'fruits-legumes' })).not.toContain('riz');
  });

  it('sont triés par ordre alphabétique, sans doublon', () => {
    const legumes = names(ratatouille.ingredients[0]!);
    expect(legumes).toEqual([...legumes].sort((a, b) => a.localeCompare(b, 'fr')));
    expect(new Set(legumes).size).toBe(legumes.length);
  });

  it('se filtrent par début de mot, sans accents ni casse', () => {
    const filet: SubstituteCandidate = { name: 'filet de bœuf', aisle: 'boucherie' };
    expect(matchesSubstituteQuery(filet, 'BOEUF')).toBe(true);
    expect(matchesSubstituteQuery(filet, 'fil')).toBe(true);
    expect(matchesSubstituteQuery(filet, 'uf')).toBe(false);
    expect(matchesSubstituteQuery(filet, '  ')).toBe(true);
  });
});

describe('remplacer un ingrédient', () => {
  it('garde la quantité et l’unité, et retient ce que la recette demandait', () => {
    const next = substituteIngredientInRecipe(ratatouille, 'courgette', 'Aubergine');
    expect(next.ingredients[0]).toEqual({
      name: 'aubergine',
      qty: 2,
      unit: 'piece',
      aisle: 'fruits-legumes',
      originalName: 'courgette',
    });
    expect(next.ingredients.slice(1)).toEqual(ratatouille.ingredients.slice(1));
  });

  it('retrouve l’ingrédient au pluriel', () => {
    const next = substituteIngredientInRecipe(ratatouille, 'courgettes', 'aubergine');
    expect(next.ingredients[0]?.name).toBe('aubergine');
  });

  it('garde le tout premier ingrédient après deux remplacements, et l’oublie au retour', () => {
    const once = substituteIngredientInRecipe(ratatouille, 'courgette', 'aubergine');
    const twice = substituteIngredientInRecipe(once, 'aubergine', 'poivron');
    expect(twice.ingredients[0]?.originalName).toBe('courgette');

    const back = substituteIngredientInRecipe(twice, 'poivron', 'courgette');
    expect(back.ingredients[0]).toEqual(ratatouille.ingredients[0]);
  });

  it('accepte un nom que la table ignore, au rayon de l’ingrédient remplacé', () => {
    const next = substituteIngredientInRecipe(ratatouille, 'courgette', 'chayotte');
    expect(next.ingredients[0]).toMatchObject({ name: 'chayotte', aisle: 'fruits-legumes' });
  });

  it('accepte un féculent d’un autre rayon, rangé dans le sien', () => {
    const next = substituteIngredientInRecipe(ratatouille, 'riz', 'pommes de terre');
    expect(next.ingredients[3]).toMatchObject({ name: 'pommes de terre', aisle: 'fruits-legumes' });
  });

  function codeOf(run: () => unknown): string | null {
    try {
      run();
      return null;
    } catch (error) {
      return error instanceof SubstitutionError ? error.code : 'autre';
    }
  }

  it('refuse un aliment d’une autre catégorie', () => {
    // La garde du plat végétarien : un légume ne devient pas de la viande.
    expect(codeOf(() => substituteIngredientInRecipe(ratatouille, 'courgette', 'lardons'))).toBe(
      'other-category',
    );
    expect(codeOf(() => substituteIngredientInRecipe(ratatouille, 'poulet', 'tofu'))).toBe(
      'other-category',
    );
  });

  it('refuse un nom vide, trop long, identique ou déjà présent', () => {
    const run = (name: string) => () =>
      substituteIngredientInRecipe(ratatouille, 'courgette', name);
    expect(codeOf(run('   '))).toBe('empty');
    expect(codeOf(run('a'.repeat(81)))).toBe('too-long');
    expect(codeOf(run('Courgettes'))).toBe('same');
    expect(codeOf(() => substituteIngredientInRecipe(ratatouille, 'riz', 'pâtes'))).toBeNull();
    const withShallot = substituteIngredientInRecipe(ratatouille, 'oignon', 'échalote');
    expect(codeOf(() => substituteIngredientInRecipe(withShallot, 'échalote', 'échalotes'))).toBe(
      'same',
    );
  });

  it('refuse un ingrédient déjà présent', () => {
    const recipe = makeRecipe({
      id: 'deux-legumes',
      ingredients: [
        { name: 'courgette', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
        { name: 'aubergine', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
      ],
    });
    expect(codeOf(() => substituteIngredientInRecipe(recipe, 'courgette', 'aubergine'))).toBe(
      'already-present',
    );
  });

  it('refuse un ingrédient que la recette ne contient plus', () => {
    expect(codeOf(() => substituteIngredientInRecipe(ratatouille, 'carotte', 'navet'))).toBe(
      'unknown-ingredient',
    );
  });

  it('refuse un produit sans catégorie', () => {
    const recipe = makeRecipe({
      id: 'bizarre',
      ingredients: [{ name: 'éponge', qty: 1, unit: 'piece', aisle: 'entretien' }],
    });
    expect(codeOf(() => substituteIngredientInRecipe(recipe, 'éponge', 'lavette'))).toBe(
      'not-substitutable',
    );
  });
});

describe('problème de remplacement', () => {
  it('rend le message du refus, ou null si le remplacement passe', () => {
    expect(substitutionProblem(ratatouille, 'courgette', 'aubergine')).toBeNull();
    expect(substitutionProblem(ratatouille, 'courgette', 'lardons')).toMatch(/même catégorie/);
  });

  // Seul un refus de la règle devient un message : une panne reste une panne.
  it('laisse remonter une erreur qui n’est pas un refus', () => {
    const broken = {
      get ingredients(): Recipe['ingredients'] {
        throw new TypeError('recette illisible');
      },
    };
    expect(() => substitutionProblem(broken, 'courgette', 'aubergine')).toThrow(TypeError);
  });
});
