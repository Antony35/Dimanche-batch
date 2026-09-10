import { describe, expect, it } from 'vitest';
import { splitByVerdict } from '../preferences';
import { makeRecipe } from './fixtures';

/**
 * L'écran « Goûts du foyer » ne fait qu'afficher ce que cette fonction rend.
 * Ce qu'elle doit garantir n'est pas le filtrage — trivial — mais qu'un plat
 * n'apparaisse jamais dans les deux listes, et que l'ordre soit celui d'un
 * lecteur francophone.
 */
describe('splitByVerdict', () => {
  it('rend deux listes vides pour un foyer sans verdict', () => {
    expect(splitByVerdict([])).toEqual({ favorites: [], banned: [] });
    expect(splitByVerdict([makeRecipe({ id: 'curry' })])).toEqual({ favorites: [], banned: [] });
  });

  it('range chaque plat dans une seule liste', () => {
    const tastes = splitByVerdict([
      makeRecipe({ id: 'chili', name: 'Chili', isFavorite: true }),
      makeRecipe({ id: 'gratin', name: 'Gratin', isDisliked: true }),
      makeRecipe({ id: 'soupe', name: 'Soupe' }),
    ]);

    expect(tastes.favorites.map((recipe) => recipe.id)).toEqual(['chili']);
    expect(tastes.banned.map((recipe) => recipe.id)).toEqual(['gratin']);
  });

  // La règle borne les champs modifiables, pas leur cohérence : cet état reste
  // atteignable, et il doit se résoudre du même côté que sur le serveur.
  it('ne montre qu’en banni un plat à la fois favori et banni', () => {
    const tastes = splitByVerdict([
      makeRecipe({ id: 'gratin', name: 'Gratin', isFavorite: true, isDisliked: true }),
    ]);

    expect(tastes.favorites).toEqual([]);
    expect(tastes.banned.map((recipe) => recipe.id)).toEqual(['gratin']);
  });

  it('trie par nom selon l’alphabet français, accents compris', () => {
    const tastes = splitByVerdict([
      makeRecipe({ id: 'f', name: 'Fajitas', isFavorite: true }),
      makeRecipe({ id: 'e', name: 'Épinards à la crème', isFavorite: true }),
      makeRecipe({ id: 'b', name: 'Bœuf carottes', isFavorite: true }),
    ]);

    expect(tastes.favorites.map((recipe) => recipe.name)).toEqual([
      'Bœuf carottes',
      'Épinards à la crème',
      'Fajitas',
    ]);
  });

  it('accepte les valeurs d’une Map, comme les rend `useRecipes`', () => {
    const recipes = new Map([['chili', makeRecipe({ id: 'chili', isFavorite: true })]]);

    expect(splitByVerdict(recipes.values()).favorites).toHaveLength(1);
  });
});
