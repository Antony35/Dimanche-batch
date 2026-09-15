import type { IsoDate } from '../schemas/common';
import { parseList } from './text';
import { parseIsoDate } from './week';

/**
 * Fruits et légumes de saison, pour la moitié nord de la Loire.
 *
 * Le prompt disait « de saison » et s'arrêtait là. Un modèle de langage ne sait
 * pas ce qui pousse en Centre-Val de Loire au 14 septembre : il le devine, et se
 * tromper ne lui coûte rien — c'est au foyer que ça coûte une courgette
 * espagnole en février. La liste est donc écrite ici, une fois, et envoyée au
 * modèle avec le mois visé.
 *
 * C'est une **consigne, pas un filet**. Aucune contrainte ne refuse un plan sur
 * ce critère : l'oignon, la carotte et la pomme de terre se trouvent toute
 * l'année, les noms sont libres, et un validateur approximatif ferait rejeter
 * des plans légitimes — or chaque rejet consomme l'unique reprise.
 *
 * Le mois pris en compte est celui de la semaine visée, jamais le mois courant :
 * on compose une semaine qui commence dans sept à quatorze jours, et fin
 * septembre ce n'est pas la même récolte qu'à la mi-octobre.
 */

export interface SeasonalProduce {
  vegetables: readonly string[];
  fruits: readonly string[];
}

/** Index 0 = janvier, pour tomber sur `Date.getMonth()` sans conversion. */
const MONTHS: readonly { vegetables: string; fruits: string }[] = [
  {
    // janvier
    vegetables: `
      poireau, carotte, chou vert, chou de Bruxelles, chou-fleur, navet,
      panais, betterave, céleri-rave, endive, mâche, épinard, potiron, courge,
      topinambour, salsifis, radis noir, oignon, échalote, ail, pomme de terre
    `,
    fruits: `pomme, poire, kiwi, orange, clémentine, citron`,
  },
  {
    // février
    vegetables: `
      poireau, carotte, chou vert, chou de Bruxelles, chou-fleur, navet,
      panais, betterave, céleri-rave, endive, mâche, épinard, courge,
      topinambour, salsifis, rutabaga, radis noir, oignon, échalote,
      pomme de terre
    `,
    fruits: `pomme, poire, kiwi, orange, clémentine, citron`,
  },
  {
    // mars
    vegetables: `
      poireau, carotte, épinard, endive, chou-fleur, chou vert, navet,
      betterave, blette, cresson, radis, oignon nouveau, salade, panais,
      pomme de terre
    `,
    fruits: `pomme, poire, kiwi, citron`,
  },
  {
    // avril
    vegetables: `
      asperge, radis, épinard, blette, carotte nouvelle, navet nouveau,
      petit pois, laitue, oignon nouveau, poireau, chou-fleur, artichaut,
      cresson
    `,
    fruits: `pomme, poire, rhubarbe, fraise`,
  },
  {
    // mai
    vegetables: `
      asperge, petit pois, fève, radis, laitue, épinard, blette, artichaut,
      carotte nouvelle, navet, concombre, oignon nouveau,
      pomme de terre nouvelle, courgette
    `,
    fruits: `fraise, rhubarbe, cerise`,
  },
  {
    // juin
    vegetables: `
      courgette, haricot vert, petit pois, fève, concombre, tomate, laitue,
      betterave, carotte, blette, artichaut, ail nouveau,
      pomme de terre nouvelle, épinard, radis
    `,
    fruits: `fraise, cerise, groseille, cassis, framboise, abricot`,
  },
  {
    // juillet
    vegetables: `
      tomate, courgette, aubergine, poivron, haricot vert, concombre,
      betterave, carotte, laitue, oignon, ail, maïs, blette, pomme de terre,
      fenouil
    `,
    fruits: `
      abricot, pêche, nectarine, melon, framboise, groseille, cassis,
      myrtille, prune, cerise
    `,
  },
  {
    // août
    vegetables: `
      tomate, courgette, aubergine, poivron, haricot vert, concombre, maïs,
      betterave, carotte, oignon, poireau, blette, chou, fenouil,
      pomme de terre
    `,
    fruits: `
      pêche, nectarine, abricot, prune, mirabelle, melon, pastèque,
      framboise, mûre, figue, raisin
    `,
  },
  {
    // septembre
    vegetables: `
      tomate, courgette, aubergine, poivron, haricot vert, potiron,
      courge butternut, betterave, carotte, poireau, chou, brocoli, épinard,
      blette, oignon, maïs, champignon de Paris, fenouil, pomme de terre
    `,
    fruits: `
      raisin, pomme, poire, prune, quetsche, figue, mûre, melon, noix,
      noisette
    `,
  },
  {
    // octobre
    vegetables: `
      potiron, courge butternut, courge spaghetti, poireau, chou, chou-fleur,
      brocoli, carotte, betterave, navet, panais, céleri-rave, épinard,
      blette, champignon, endive, mâche, topinambour, pomme de terre
    `,
    fruits: `pomme, poire, raisin, coing, noix, noisette, châtaigne`,
  },
  {
    // novembre
    vegetables: `
      poireau, chou vert, chou de Bruxelles, chou-fleur, carotte, navet,
      panais, betterave, céleri-rave, courge, potiron, endive, mâche,
      épinard, topinambour, salsifis, radis noir, échalote, pomme de terre
    `,
    fruits: `pomme, poire, coing, kiwi, châtaigne, noix, clémentine`,
  },
  {
    // décembre
    vegetables: `
      poireau, chou vert, chou de Bruxelles, chou-fleur, carotte, navet,
      panais, betterave, céleri-rave, courge, potiron, endive, mâche,
      épinard, topinambour, salsifis, radis noir, crosne, pomme de terre
    `,
    fruits: `pomme, poire, kiwi, orange, clémentine, châtaigne`,
  },
];

export const SEASONAL_PRODUCE: readonly SeasonalProduce[] = MONTHS.map((month) => ({
  vegetables: parseList(month.vegetables),
  fruits: parseList(month.fruits),
}));

/** Saison du mois dans lequel tombe `iso`. */
export function getSeasonalProduce(iso: IsoDate): SeasonalProduce {
  const month = parseIsoDate(iso).getMonth();
  return SEASONAL_PRODUCE[month] ?? { vegetables: [], fruits: [] };
}

/**
 * Deux lignes prêtes à être collées dans le prompt.
 *
 * Rendu ici et non dans `prompt.ts` pour que le format se teste sans réseau, au
 * même endroit que la table qu'il décrit.
 */
export function describeSeasonalProduce(iso: IsoDate): string {
  const produce = getSeasonalProduce(iso);
  return [
    `Légumes de saison : ${produce.vegetables.join(', ')}.`,
    `Fruits de saison : ${produce.fruits.join(', ')}.`,
  ].join('\n');
}
