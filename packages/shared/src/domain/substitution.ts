import type { Aisle } from '../schemas/common';
import { AISLES } from '../schemas/common';
import type { Ingredient, Recipe } from '../schemas/recipe';
import { aisleOverrideKey, catalogNames, lookupAisle, matchLongestGram } from './aisle-lookup';
import { capitalize, parseList, singularizeWords } from './text';

/**
 * Remplacer un ingrédient d'une recette par un autre de même nature.
 *
 * Il manque la courgette, on prend une aubergine ; le foyer n'aime pas le
 * cabillaud, ce sera du lieu. On ne remplace qu'à l'intérieur d'une catégorie
 * — viande pour viande, légume pour légume — et c'est ce qui rend le geste sûr
 * sans le soumettre au modèle : un plat végétarien ne gagne pas de viande, et la
 * quantité de la recette garde un sens.
 *
 * Les catégories ne sont pas une seconde table d'aliments. La réserve des
 * remplaçants est celle du rayon (`catalogNames`), la table que la liste de
 * courses tient déjà ; ce module ne fait que la découper plus finement, parce
 * qu'un rayon mêle trop de choses : les fruits et légumes rangent la fraise à
 * côté de la courgette, l'épicerie les pâtes à côté du cumin.
 */

interface CategoryDefinition {
  label: string;
  /** Rayons où ses membres sont reconnus : « pomme » n'est un fruit qu'au frais. */
  aisles: readonly Aisle[];
  /** Membres explicites. Une catégorie sans membre n'est que le défaut d'un rayon. */
  members: string;
}

/**
 * Catégories, des plus fines aux plus larges. Un ingrédient est d'abord cherché
 * parmi les membres explicites — le groupe de mots le plus long gagne, comme
 * pour les rayons —, sinon il tombe dans la catégorie par défaut de son rayon.
 */
const CATEGORIES = {
  // « courge spaghetti » est un légume, pas des spaghettis.
  legume: { label: 'Légumes', aisles: ['fruits-legumes'], members: 'courge spaghetti' },
  aromate: {
    label: 'Aromates',
    aisles: ['fruits-legumes'],
    members: `ail, ail nouveau, échalote, oignon, oignon nouveau, oignon rouge, ciboule,
      gingembre, citronnelle`,
  },
  herbe: {
    label: 'Herbes',
    aisles: ['fruits-legumes', 'epicerie'],
    members: `aneth, basilic, cerfeuil, ciboulette, coriandre, estragon, menthe, persil,
      romarin, sarriette, sauge, thym, laurier, feuille de laurier, herbes de Provence`,
  },
  fruit: {
    label: 'Fruits',
    aisles: ['fruits-legumes'],
    members: `ananas, banane, cassis, cerise, citron, citron vert, clémentine, coing, figue,
      fraise, framboise, fruit de la passion, grenade, groseille, kaki, kiwi, mandarine,
      mangue, melon, mirabelle, mûre, myrtille, nectarine, orange, pamplemousse, papaye,
      pastèque, pêche, poire, pomelo, pomme, prune, quetsche, raisin, rhubarbe`,
  },
  feculent: {
    label: 'Féculents',
    aisles: ['fruits-legumes', 'epicerie'],
    members: `pomme de terre, pomme de terre nouvelle, patate douce, boulgour, couscous,
      fusilli, lasagne, macaroni, nouille, orzo, pâtes, penne, polenta, quinoa, riz,
      riz basmati, riz complet, riz rond, sarrasin, semoule, spaghetti, vermicelle`,
  },
  legumineuse: {
    label: 'Légumineuses',
    aisles: ['epicerie', 'surgeles'],
    members: `flageolet, haricot blanc, haricot rouge, lentille, lentille corail,
      lentille verte, pois cassé, pois chiche, tofu, edamame`,
  },
  viande: { label: 'Viandes', aisles: ['boucherie'], members: '' },
  charcuterie: {
    label: 'Charcuterie',
    aisles: ['boucherie'],
    members: `andouille, bacon, boudin blanc, boudin noir, bresaola, cervelas, chipolata,
      chorizo, coppa, galantine, jambon, jambon blanc, jambon cru, jambon de Bayonne, knack,
      lard, lardon, merguez, mortadelle, pancetta, pâté, poitrine fumée, rillettes, salami,
      saucisse, saucisse de Morteau, saucisse de Toulouse, saucisson, speck, terrine`,
  },
  poisson: { label: 'Poissons', aisles: ['poissonnerie'], members: '' },
  'fruits-de-mer': {
    label: 'Fruits de mer',
    aisles: ['poissonnerie'],
    members: `bigorneau, bulot, calamar, coque, coquille Saint-Jacques, couteau, crabe,
      crevette, crevette rose, encornet, gambas, homard, huître, langoustine, moule, oursin,
      palourde, poulpe, seiche, tourteau`,
  },
  fromage: { label: 'Fromages', aisles: ['cremerie'], members: '' },
  laitier: {
    label: 'Produits laitiers',
    aisles: ['cremerie', 'epicerie'],
    members: `babeurre, chantilly, crème, crème épaisse, crème fraîche, crème liquide,
      faisselle, fromage blanc, kéfir, lait, lait demi-écrémé, lait écrémé, lait entier,
      lait ribot, petit-suisse, skyr, yaourt, yaourt grec, yaourt nature, lait de coco`,
  },
  'matiere-grasse': {
    label: 'Matières grasses',
    aisles: ['cremerie', 'epicerie'],
    members: `beurre, beurre demi-sel, beurre doux, margarine, huile, huile d'olive,
      huile de colza, huile de sésame, huile de tournesol`,
  },
  oeuf: { label: 'Œufs', aisles: ['cremerie'], members: 'œuf, oeuf' },
  pate: {
    label: 'Pâtes à tarte',
    aisles: ['cremerie', 'epicerie'],
    members: 'pâte à pizza, pâte brisée, pâte feuilletée, pâte sablée, feuille de brick',
  },
  pain: { label: 'Pains', aisles: ['boulangerie'], members: '' },
  epice: {
    label: 'Épices',
    aisles: ['epicerie'],
    members: `anis, cannelle, cardamome, clou de girofle, cumin, curcuma, curry, épice,
      noix de muscade, paprika, piment, poivre, ras el hanout, safran, sel, vanille`,
  },
  sucrant: {
    label: 'Sucres',
    aisles: ['epicerie'],
    members: `cassonade, miel, sirop d'agave, sirop d'érable, sucre, sucre glace,
      sucre vanillé, confiture, marmelade, crème de marron, lait concentré,
      pâte à tartiner`,
  },
  'fruit-sec': {
    label: 'Fruits secs et graines',
    aisles: ['epicerie'],
    members: `abricot sec, amande, amande en poudre, arachide, beurre de cacahuète,
      cacahuète, coco râpé, datte, figue sèche, graine de chia, graine de courge,
      graine de lin, graine de sésame, graine de tournesol, noix, noix de cajou, noisette,
      pignon, pistache, pruneau, raisin sec, sésame`,
  },
  tomate: {
    label: 'Tomates cuisinées',
    aisles: ['epicerie'],
    members: `concentré de tomate, coulis de tomate, purée de tomate, sauce tomate,
      tomate concassée, tomate pelée`,
  },
  condiment: {
    label: 'Sauces et condiments',
    aisles: ['epicerie'],
    members: `câpre, chutney, cornichon, harissa, ketchup, mayonnaise, miso, moutarde, olive,
      pâte de curry, pesto, sauce, sauce soja, tabasco, tahini, vinaigre, vinaigre balsamique,
      vinaigre de cidre, wasabi`,
  },
  farine: {
    label: 'Farines et fécules',
    aisles: ['epicerie'],
    members: 'farine, farine de blé, farine de maïs, fécule, maïzena, chapelure',
  },
  bouillon: {
    label: 'Bouillons',
    aisles: ['epicerie'],
    members: 'bouillon, bouillon cube, fond de veau',
  },
  // Une galette de riz est un biscuit, pas du riz.
  epicerie: { label: 'Épicerie', aisles: ['epicerie'], members: 'galette de riz' },
  surgele: { label: 'Surgelés', aisles: ['surgeles'], members: '' },
  boisson: { label: 'Boissons', aisles: ['boissons'], members: '' },
} satisfies Record<string, CategoryDefinition>;

export type SubstituteCategory = keyof typeof CATEGORIES;

/**
 * Catégorie de ce qui n'a pas de membre explicite, rayon par rayon. Les
 * produits ménagers n'en ont pas : aucune recette ne les cite.
 */
const DEFAULT_CATEGORY: Record<Aisle, SubstituteCategory | null> = {
  'fruits-legumes': 'legume',
  boucherie: 'viande',
  poissonnerie: 'poisson',
  cremerie: 'fromage',
  boulangerie: 'pain',
  epicerie: 'epicerie',
  surgeles: 'surgele',
  boissons: 'boisson',
  entretien: null,
  hygiene: null,
  autre: null,
};

/** Membres explicites, indexés par clé de recherche puis par rayon. */
const MEMBERS: ReadonlyMap<
  string,
  readonly { category: SubstituteCategory; aisles: readonly Aisle[] }[]
> = buildMembers();

function buildMembers() {
  const members = new Map<string, { category: SubstituteCategory; aisles: readonly Aisle[] }[]>();
  for (const [category, definition] of categoryEntries()) {
    for (const entry of parseList(definition.members)) {
      const key = aisleOverrideKey(entry);
      for (const variant of new Set([key, singularizeWords(key)])) {
        const list = members.get(variant) ?? [];
        list.push({ category, aisles: definition.aisles });
        members.set(variant, list);
      }
    }
  }
  return members;
}

function categoryEntries(): [SubstituteCategory, CategoryDefinition][] {
  const keys = Object.keys(CATEGORIES).filter(isSubstituteCategory);
  return keys.map((key) => [key, CATEGORIES[key]]);
}

function isSubstituteCategory(value: string): value is SubstituteCategory {
  return value in CATEGORIES;
}

/** Libellé affiché d'une catégorie : « Légumes », « Viandes ». */
export function substituteCategoryLabel(category: SubstituteCategory): string {
  return CATEGORIES[category].label;
}

/**
 * Catégorie d'un aliment rangé dans ce rayon, ou `null` si rien ne le
 * remplace — un produit ménager, un article de rayon inconnu.
 */
export function substituteCategory(name: string, aisle: Aisle): SubstituteCategory | null {
  const explicit = matchLongestGram(name, (gram, singular) => {
    const candidates = MEMBERS.get(gram) ?? MEMBERS.get(singular);
    return candidates?.find((candidate) => candidate.aisles.includes(aisle))?.category;
  });
  return explicit ?? DEFAULT_CATEGORY[aisle];
}

export interface SubstituteCandidate {
  /** Nom tel qu'il sera écrit dans la recette : en minuscules, comme le modèle l'écrit. */
  name: string;
  aisle: Aisle;
}

/**
 * Forme de recherche d'un nom, ligatures dépliées : on tape « boeuf » sur un
 * téléphone, la table écrit « bœuf ».
 */
function searchKey(name: string): string {
  return aisleOverrideKey(name).replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}

/** Clé de comparaison de deux noms d'ingrédient : « Oignons » égale « oignon ». */
function sameIngredientKey(name: string): string {
  return singularizeWords(searchKey(name));
}

/**
 * Remplaçants proposés pour un ingrédient de la recette : tous les articles de
 * la table qui partagent sa catégorie, sauf lui-même et ce que la recette
 * contient déjà. Triés dans l'ordre alphabétique — la liste se parcourt avec
 * une recherche, pas par pertinence.
 */
export function substituteCandidates(
  ingredient: Pick<Ingredient, 'name' | 'aisle'>,
  recipe: Pick<Recipe, 'ingredients'>,
): SubstituteCandidate[] {
  const category = substituteCategory(ingredient.name, ingredient.aisle);
  if (category === null) return [];

  const taken = new Set(recipe.ingredients.map((entry) => sameIngredientKey(entry.name)));
  taken.add(sameIngredientKey(ingredient.name));

  const seen = new Set<string>();
  const candidates: SubstituteCandidate[] = [];
  for (const aisle of AISLES) {
    for (const written of catalogNames(aisle)) {
      const key = sameIngredientKey(written);
      if (taken.has(key) || seen.has(key)) continue;
      if (substituteCategory(written, aisle) !== category) continue;
      seen.add(key);
      candidates.push({ name: written.toLocaleLowerCase('fr'), aisle });
    }
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/**
 * Filtre de la recherche : sans accents ni casse, sur un début de mot —
 * « bœuf » trouve « filet de bœuf », « uf » ne trouve rien.
 */
export function matchesSubstituteQuery(candidate: SubstituteCandidate, query: string): boolean {
  const needle = searchKey(query);
  if (!needle) return true;
  return ` ${searchKey(candidate.name)}`.includes(` ${needle}`);
}

/** Pourquoi un remplacement est refusé. Le message s'affiche tel quel. */
export class SubstitutionError extends Error {
  constructor(
    readonly code:
      | 'unknown-ingredient'
      | 'empty'
      | 'too-long'
      | 'same'
      | 'already-present'
      | 'not-substitutable'
      | 'other-category',
    message: string,
  ) {
    super(message);
    this.name = 'SubstitutionError';
  }
}

const MAX_NAME_LENGTH = 80;

/**
 * L'ingrédient qui prendra la place de `original`, ou une `SubstitutionError`.
 *
 * Le nom peut venir de la liste proposée ou être tapé à la main. Un nom que la
 * table reconnaît doit être de la même catégorie ; un nom qu'elle ignore est
 * accepté et garde le rayon de l'ingrédient remplacé — refuser tout ce que la
 * table ne connaît pas rendrait le geste inutilisable pour un produit local.
 * Ce n'est pas un trou dans la règle végétarienne : un inconnu ne change pas
 * de rayon, donc un légume ne devient jamais un article de boucherie.
 *
 * La quantité et l'unité sont conservées. `originalName` garde le tout premier
 * ingrédient, pour que la fiche dise ce que la recette demandait et que les
 * étapes, qui ne sont pas réécrites, se comprennent encore.
 */
function substituteIngredient(
  original: Ingredient,
  rawName: string,
  recipe: Pick<Recipe, 'ingredients'>,
): Ingredient {
  const name = rawName.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
  if (!name) throw new SubstitutionError('empty', 'Indique par quoi remplacer cet ingrédient.');
  if (name.length > MAX_NAME_LENGTH) {
    throw new SubstitutionError('too-long', 'Ce nom est trop long pour un ingrédient.');
  }

  const key = sameIngredientKey(name);
  if (key === sameIngredientKey(original.name)) {
    throw new SubstitutionError('same', `La recette utilise déjà ${original.name}.`);
  }
  if (recipe.ingredients.some((entry) => sameIngredientKey(entry.name) === key)) {
    throw new SubstitutionError(
      'already-present',
      `${capitalize(name)} est déjà dans la recette : choisis un autre ingrédient.`,
    );
  }

  const category = substituteCategory(original.name, original.aisle);
  if (category === null) {
    throw new SubstitutionError('not-substitutable', 'Cet ingrédient ne se remplace pas.');
  }

  const known = lookupAisle(name);
  const aisle = known ?? original.aisle;
  if (known !== null && substituteCategory(name, known) !== category) {
    throw new SubstitutionError(
      'other-category',
      `${capitalize(name)} n’est pas dans la même catégorie : choisis parmi les ` +
        `${substituteCategoryLabel(category).toLocaleLowerCase('fr')}.`,
    );
  }

  const originalName = original.originalName ?? original.name;
  const back = sameIngredientKey(originalName) === key;
  return {
    name,
    qty: original.qty,
    unit: original.unit,
    aisle,
    ...(back ? {} : { originalName }),
  };
}

/**
 * La recette, avec l'ingrédient nommé remplacé. L'ingrédient est désigné par
 * son nom et non par sa position : entre l'ouverture de la fiche et l'appui,
 * l'autre téléphone a pu modifier la recette.
 */
export function substituteIngredientInRecipe<T extends Pick<Recipe, 'ingredients'>>(
  recipe: T,
  ingredientName: string,
  substitute: string,
): T {
  const target = sameIngredientKey(ingredientName);
  const index = recipe.ingredients.findIndex((entry) => sameIngredientKey(entry.name) === target);
  const original = recipe.ingredients[index];
  if (!original) {
    throw new SubstitutionError(
      'unknown-ingredient',
      'Cet ingrédient n’est plus dans la recette, sans doute modifiée depuis l’autre téléphone.',
    );
  }

  const others = { ingredients: recipe.ingredients.filter((_, i) => i !== index) };
  const next = substituteIngredient(original, substitute, others);
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((entry, i) => (i === index ? next : entry)),
  };
}

/**
 * Pourquoi ce remplacement serait refusé, ou `null` s'il passe. La même règle
 * que la callable, lue par l'app pour le dire avant l'appel plutôt qu'après.
 */
export function substitutionProblem(
  recipe: Pick<Recipe, 'ingredients'>,
  ingredientName: string,
  substitute: string,
): string | null {
  try {
    substituteIngredientInRecipe(recipe, ingredientName, substitute);
    return null;
  } catch (error) {
    if (error instanceof SubstitutionError) return error.message;
    throw error;
  }
}
