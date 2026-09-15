import type { BatchCut } from '../schemas/batch-schedule';
import type { Aisle, Unit } from '../schemas/common';
import type { Recipe } from '../schemas/recipe';
import { scaleIngredients } from './batch';
import { normalizeName } from './text';
import { toBaseQuantity } from './units';

/**
 * Ce qu'on coupe d'un coup, avant de cuisiner.
 *
 * L'ordre suit une vraie session de batch, et c'est aussi l'ordre d'hygiène :
 * les oignons, l'ail, les légumes, les herbes, puis la viande et le poisson —
 * on ne repasse jamais sur une planche qui a vu du cru.
 *
 * Seuls les rayons qui se coupent y figurent. L'huile, le beurre, les épices
 * sortent sans liste à tenir : leur rayon — épicerie, crèmerie — suffit à les
 * écarter, et il est déjà obligatoire sur chaque ingrédient.
 *
 * Les quantités sont celles des portions réellement cuisinées
 * (`scaleIngredients`), donc celles de la liste de courses. Un ingrédient est
 * reconnu par son seul nom au singulier : 300 g de carotte dans un plat et deux
 * carottes dans l'autre font une ligne, chaque part gardant son unité. Rien ici
 * ne s'additionne entre plats, donc des unités différentes ne gênent pas —
 * contrairement à la liste de courses.
 */

/**
 * Groupes, dans l'ordre de la planche. Les aromates d'abord — oignons, ail,
 * herbes à ciseler —, parce qu'ils servent presque tous les plats et qu'on les
 * prépare en une fois.
 */
export const MISE_EN_PLACE_GROUPS = ['aromates', 'legumes', 'viande', 'poisson'] as const;

export type MiseEnPlaceGroup = (typeof MISE_EN_PLACE_GROUPS)[number];

export interface MiseEnPlaceShare {
  recipeId: string;
  qty: number;
  unit: Unit;
  /** « émincé », connu une fois la session composée. */
  cut: string | null;
}

export interface MiseEnPlaceLine {
  key: string;
  /** Nom tel que la première recette l'écrit. */
  name: string;
  group: MiseEnPlaceGroup;
  /** Une part par plat, dans l'ordre des recettes reçues. */
  shares: MiseEnPlaceShare[];
}

const ONION_FAMILY: ReadonlySet<string> = new Set(['oignon', 'echalote']);
const GARLIC: ReadonlySet<string> = new Set(['ail']);
/** Les herbes qui se ciselent. */
const CUT_HERBS: ReadonlySet<string> = new Set([
  'persil',
  'coriandre',
  'ciboulette',
  'basilic',
  'menthe',
  'aneth',
  'cerfeuil',
  'estragon',
]);
/**
 * Les herbes qui se mettent en branche. Elles ne se coupent pas, donc elles
 * n'ont rien à faire dans la mise en place — sans cette liste, elles
 * tomberaient dans les légumes.
 */
const SPRIG_HERBS: ReadonlySet<string> = new Set([
  'thym',
  'romarin',
  'laurier',
  'sauge',
  'sarriette',
]);

/** Ordre au sein des aromates : oignons, puis ail, puis herbes. */
function aromaticRank(name: string): number {
  const word = firstWord(name);
  if (ONION_FAMILY.has(word)) return 0;
  if (GARLIC.has(word)) return 1;
  return 2;
}

/**
 * Nom ramené au singulier, mot par mot.
 *
 * Le prompt demande des noms au singulier, mais deux recettes écrites à deux
 * moments différents disent parfois « oignons » et « oignon ». Sur la planche,
 * c'est le même légume : il doit tomber sur la même ligne.
 */
export function singularIngredientName(name: string): string {
  return normalizeName(name)
    .split(' ')
    .map((word) => (word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word))
    .join(' ');
}

function firstWord(name: string): string {
  return (
    singularIngredientName(name)
      .split(/[^a-z]+/)
      .find(Boolean) ?? ''
  );
}

/** Groupe d'un ingrédient, ou `null` s'il ne se coupe pas. */
export function miseEnPlaceGroup(name: string, aisle: Aisle): MiseEnPlaceGroup | null {
  if (aisle === 'boucherie') return 'viande';
  if (aisle === 'poissonnerie') return 'poisson';
  if (aisle !== 'fruits-legumes') return null;

  const word = firstWord(name);
  // Tous les mots, pas seulement le premier : « feuille de laurier ».
  const words = singularIngredientName(name).split(/[^a-z]+/);
  if (words.some((candidate) => SPRIG_HERBS.has(candidate))) return null;
  if (ONION_FAMILY.has(word) || GARLIC.has(word) || CUT_HERBS.has(word)) return 'aromates';
  return 'legumes';
}

export function getMiseEnPlace(
  entries: readonly { recipe: Recipe; portions: number }[],
  cuts: readonly BatchCut[] = [],
): MiseEnPlaceLine[] {
  const cutOf = (recipeId: string, name: string): string | null =>
    cuts.find(
      (cut) =>
        cut.recipeId === recipeId &&
        singularIngredientName(cut.ingredient) === singularIngredientName(name),
    )?.cut ?? null;

  const lines = new Map<string, MiseEnPlaceLine>();

  for (const { recipe, portions } of entries) {
    for (const ingredient of scaleIngredients(recipe, portions)) {
      const group = miseEnPlaceGroup(ingredient.name, ingredient.aisle);
      if (group === null) continue;

      const base = toBaseQuantity(ingredient.qty, ingredient.unit);
      const key = singularIngredientName(ingredient.name);
      const line = lines.get(key) ?? { key, name: ingredient.name.trim(), group, shares: [] };

      // On n'additionne qu'à unité égale : un plat qui cite la carotte en
      // grammes et en pièces garde deux parts.
      const share = line.shares.find(
        (candidate) => candidate.recipeId === recipe.id && candidate.unit === base.unit,
      );
      if (share) share.qty += base.qty;
      else
        line.shares.push({
          recipeId: recipe.id,
          qty: base.qty,
          unit: base.unit,
          cut: cutOf(recipe.id, ingredient.name),
        });
      lines.set(key, line);
    }
  }

  return [...lines.values()].sort((a, b) => {
    const byGroup = MISE_EN_PLACE_GROUPS.indexOf(a.group) - MISE_EN_PLACE_GROUPS.indexOf(b.group);
    if (byGroup !== 0) return byGroup;
    if (a.group === 'aromates') {
      const byRank = aromaticRank(a.name) - aromaticRank(b.name);
      if (byRank !== 0) return byRank;
    }
    return a.name.localeCompare(b.name, 'fr');
  });
}
