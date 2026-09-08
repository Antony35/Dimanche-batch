/**
 * Palette de l'application, reprise du plan de projet : un vert cuisine pour
 * les actions, un ambre épice pour ce qui se congèle, un violet discret pour
 * le week-end.
 *
 * Les deux thèmes définissent exactement les mêmes clés — un composant ne doit
 * jamais avoir à se demander si une couleur existe dans le mode courant.
 */

export interface Palette {
  bg: string;
  bgRaised: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  line: string;
  lineSoft: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  spice: string;
  spiceSoft: string;
  spiceInk: string;
  weekend: string;
  weekendSoft: string;
  danger: string;
  dangerSoft: string;
}

export const lightPalette: Palette = {
  bg: '#f5f6f2',
  bgRaised: '#ffffff',
  ink: '#20261f',
  inkSoft: '#4c564a',
  inkFaint: '#7d8878',
  line: '#dbe0d5',
  lineSoft: '#e8ebe2',
  accent: '#2f6b5e',
  accentSoft: '#e3ede9',
  accentInk: '#ffffff',
  spice: '#c07f2a',
  spiceSoft: '#f5e8d5',
  spiceInk: '#3a2a10',
  weekend: '#6b5a8c',
  weekendSoft: '#ece7f2',
  danger: '#a8382c',
  dangerSoft: '#f7e4e1',
};

export const darkPalette: Palette = {
  bg: '#171b16',
  bgRaised: '#1f2420',
  ink: '#e7ebe2',
  inkSoft: '#b7c0b0',
  inkFaint: '#7c8877',
  line: '#333c30',
  lineSoft: '#262d24',
  accent: '#7fd6bf',
  accentSoft: '#223530',
  accentInk: '#0e1f1a',
  spice: '#e4a94f',
  spiceSoft: '#33270f',
  spiceInk: '#f6e2bb',
  weekend: '#b9a6dd',
  weekendSoft: '#2a2436',
  danger: '#e88b7d',
  dangerSoft: '#3a201c',
};
