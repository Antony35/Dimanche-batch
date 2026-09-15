import { describe, expect, it } from 'vitest';
import { getMiseEnPlace, miseEnPlaceGroup } from '../mise-en-place';
import { makeRecipe } from './fixtures';

/**
 * La mise en place dit quoi couper, dans quel ordre, et pour quel plat. Elle
 * se calcule depuis les recettes : pas de modèle, pas de génération.
 */
const bourguignon = makeRecipe({
  id: 'bourguignon',
  servings: 8,
  ingredients: [
    { name: 'bœuf', qty: 800, unit: 'g', aisle: 'boucherie' },
    { name: 'carotte', qty: 4, unit: 'piece', aisle: 'fruits-legumes' },
    { name: 'oignon', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
    { name: 'huile d’olive', qty: 2, unit: 'cas', aisle: 'epicerie' },
    { name: 'beurre', qty: 30, unit: 'g', aisle: 'cremerie' },
  ],
});
const chili = makeRecipe({
  id: 'chili',
  servings: 6,
  ingredients: [
    { name: 'Oignons', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
    { name: 'ail', qty: 2, unit: 'gousse', aisle: 'fruits-legumes' },
    { name: 'persil', qty: 1, unit: 'botte', aisle: 'fruits-legumes' },
    { name: 'cabillaud', qty: 400, unit: 'g', aisle: 'poissonnerie' },
    { name: 'cumin', qty: 1, unit: 'cac', aisle: 'epicerie' },
  ],
});

describe('miseEnPlaceGroup', () => {
  it('range chaque ingrédient qui se coupe dans son groupe', () => {
    expect(miseEnPlaceGroup('oignon rouge', 'fruits-legumes')).toBe('aromates');
    expect(miseEnPlaceGroup('Échalotes', 'fruits-legumes')).toBe('aromates');
    expect(miseEnPlaceGroup('ail', 'fruits-legumes')).toBe('aromates');
    expect(miseEnPlaceGroup('coriandre', 'fruits-legumes')).toBe('aromates');
    expect(miseEnPlaceGroup('courgette', 'fruits-legumes')).toBe('legumes');
    expect(miseEnPlaceGroup('poulet', 'boucherie')).toBe('viande');
    expect(miseEnPlaceGroup('saumon', 'poissonnerie')).toBe('poisson');
  });

  // Ni liste de placard à tenir, ni oubli : le rayon suffit.
  it('écarte ce qui ne se coupe pas, par son rayon', () => {
    expect(miseEnPlaceGroup('huile d’olive', 'epicerie')).toBeNull();
    expect(miseEnPlaceGroup('beurre', 'cremerie')).toBeNull();
    expect(miseEnPlaceGroup('petits pois surgelés', 'surgeles')).toBeNull();
  });

  // Elles se mettent en branche : rien à couper.
  it('écarte les herbes qui ne se coupent pas', () => {
    for (const herb of ['thym', 'romarin', 'feuille de laurier', 'laurier', 'sauge']) {
      expect(miseEnPlaceGroup(herb, 'fruits-legumes')).toBeNull();
    }
  });
});

describe('getMiseEnPlace', () => {
  const lines = getMiseEnPlace([
    { recipe: bourguignon, portions: 8 },
    { recipe: chili, portions: 6 },
  ]);

  it('suit l’ordre de la planche : aromates, légumes, viande, poisson', () => {
    expect(lines.map((line) => line.group)).toEqual([
      'aromates',
      'aromates',
      'aromates',
      'legumes',
      'viande',
      'poisson',
    ]);
  });

  it('range les aromates : oignons, puis ail, puis herbes', () => {
    expect(
      lines.filter((line) => line.group === 'aromates').map((line) => line.name.toLowerCase()),
    ).toEqual(['oignon', 'ail', 'persil']);
  });

  /**
   * La carotte comptée en grammes dans un plat et en pièces dans l'autre
   * tombait sur deux lignes. Sur la planche, c'est le même légume.
   */
  it('met un même légume sur une seule ligne, chaque part dans son unité', () => {
    const soupe = makeRecipe({
      id: 'soupe',
      ingredients: [{ name: 'carottes', qty: 300, unit: 'g', aisle: 'fruits-legumes' }],
    });
    const carrots = getMiseEnPlace([
      { recipe: bourguignon, portions: 8 },
      { recipe: soupe, portions: 2 },
    ]).filter((line) => line.key === 'carotte');

    expect(carrots).toHaveLength(1);
    expect(carrots[0]?.shares).toEqual([
      { recipeId: 'bourguignon', qty: 4, unit: 'piece', cut: null },
      { recipeId: 'soupe', qty: 300, unit: 'g', cut: null },
    ]);
  });

  it('garde deux parts pour un plat qui cite l’ingrédient dans deux unités', () => {
    const mixte = makeRecipe({
      id: 'mixte',
      ingredients: [
        { name: 'carotte', qty: 2, unit: 'piece', aisle: 'fruits-legumes' },
        { name: 'carotte', qty: 100, unit: 'g', aisle: 'fruits-legumes' },
        { name: 'carotte', qty: 1, unit: 'piece', aisle: 'fruits-legumes' },
      ],
    });
    const [line] = getMiseEnPlace([{ recipe: mixte, portions: 2 }]);
    expect(line?.shares.map((share) => [share.qty, share.unit])).toEqual([
      [3, 'piece'],
      [100, 'g'],
    ]);
  });

  it('n’affiche ni huile, ni beurre, ni épices', () => {
    const names = lines.map((line) => line.name.toLowerCase());
    expect(names).not.toContain('huile d’olive');
    expect(names).not.toContain('beurre');
    expect(names).not.toContain('cumin');
  });

  it('réunit un même ingrédient et donne la part de chaque plat', () => {
    const oignon = lines.find((line) => line.key === 'oignon');
    expect(oignon?.shares).toEqual([
      { recipeId: 'bourguignon', qty: 2, unit: 'piece', cut: null },
      { recipeId: 'chili', qty: 1, unit: 'piece', cut: null },
    ]);
  });

  it('donne les quantités des portions réellement cuisinées', () => {
    // Le bourguignon ne sert plus que trois repas : 6 portions sur 8.
    const scaled = getMiseEnPlace([{ recipe: bourguignon, portions: 6 }]);
    expect(scaled.find((line) => line.group === 'viande')?.shares[0]?.qty).toBe(600);
    expect(scaled.find((line) => line.name === 'carotte')?.shares[0]?.qty).toBe(3);
  });

  it('attache la découpe composée par la session, plat par plat', () => {
    const withCuts = getMiseEnPlace(
      [
        { recipe: bourguignon, portions: 8 },
        { recipe: chili, portions: 6 },
      ],
      [
        { recipeId: 'bourguignon', ingredient: 'Oignon', cut: 'émincé' },
        { recipeId: 'chili', ingredient: 'oignons', cut: 'en dés' },
      ],
    );
    const oignon = withCuts.find((line) => line.key === 'oignon');
    expect(oignon?.shares.map((share) => share.cut)).toEqual(['émincé', 'en dés']);
  });

  it('ne rend rien pour une semaine sans rien à couper', () => {
    const placard = makeRecipe({
      id: 'riz',
      ingredients: [{ name: 'riz', qty: 200, unit: 'g', aisle: 'epicerie' }],
    });
    expect(getMiseEnPlace([{ recipe: placard, portions: 2 }])).toEqual([]);
  });
});
