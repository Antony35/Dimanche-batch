import type { Unit } from '../schemas/common';

/**
 * Deux quantités ne sont additionnables que si leurs unités partagent une
 * dimension. Masse et volume ont une unité de base ; tout le reste est sa
 * propre dimension (agréger « 2 cas » et « 30 ml » d'huile donnerait un
 * résultat exact mais illisible sur une liste de courses).
 */
type Dimension = 'mass' | 'volume' | Unit;

interface UnitDef {
  dimension: Dimension;
  /** Facteur vers l'unité de base de la dimension. */
  factor: number;
  base: Unit;
}

const UNIT_DEFS: Record<Unit, UnitDef> = {
  g: { dimension: 'mass', factor: 1, base: 'g' },
  kg: { dimension: 'mass', factor: 1000, base: 'g' },
  ml: { dimension: 'volume', factor: 1, base: 'ml' },
  cl: { dimension: 'volume', factor: 10, base: 'ml' },
  l: { dimension: 'volume', factor: 1000, base: 'ml' },
  piece: { dimension: 'piece', factor: 1, base: 'piece' },
  cas: { dimension: 'cas', factor: 1, base: 'cas' },
  cac: { dimension: 'cac', factor: 1, base: 'cac' },
  pincee: { dimension: 'pincee', factor: 1, base: 'pincee' },
  botte: { dimension: 'botte', factor: 1, base: 'botte' },
  gousse: { dimension: 'gousse', factor: 1, base: 'gousse' },
};

export function dimensionOf(unit: Unit): Dimension {
  return UNIT_DEFS[unit].dimension;
}

/** Convertit vers l'unité de base de la dimension de `unit`. */
export function toBaseQuantity(qty: number, unit: Unit): { qty: number; unit: Unit } {
  const def = UNIT_DEFS[unit];
  return { qty: qty * def.factor, unit: def.base };
}

/**
 * Remonte vers l'unité lisible la plus adaptée : 1500 g devient 1,5 kg.
 * N'est appelé qu'à l'affichage — le stockage reste en unité de base.
 */
export function toDisplayQuantity(qty: number, unit: Unit): { qty: number; unit: Unit } {
  if (unit === 'g' && qty >= 1000) return { qty: round(qty / 1000, 2), unit: 'kg' };
  if (unit === 'ml' && qty >= 1000) return { qty: round(qty / 1000, 2), unit: 'l' };
  return { qty: round(qty, 2), unit };
}

const UNIT_LABELS: Record<Unit, { short: string; plural?: string }> = {
  g: { short: 'g' },
  kg: { short: 'kg' },
  ml: { short: 'ml' },
  cl: { short: 'cl' },
  l: { short: 'L' },
  piece: { short: '', plural: '' },
  cas: { short: 'c. à s.' },
  cac: { short: 'c. à c.' },
  pincee: { short: 'pincée', plural: 'pincées' },
  botte: { short: 'botte', plural: 'bottes' },
  gousse: { short: 'gousse', plural: 'gousses' },
};

/** Rend « 1,5 kg » ou « 2 gousses » — séparateur décimal français. */
export function formatQuantity(qty: number, unit: Unit): string {
  const display = toDisplayQuantity(qty, unit);
  const label = UNIT_LABELS[display.unit];
  const suffix = display.qty > 1 && label.plural !== undefined ? label.plural : label.short;
  const number = formatNumber(display.qty);
  return suffix ? `${number} ${suffix}` : number;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Pas d'arrondi de chaque unité, pour une liste de courses qu'on lit d'un œil.
 *
 * Personne n'achète 227 g de riz : on prend 230 g. Les unités de base de
 * l'agrégation — le gramme et le millilitre — montent donc de 5 en 5, et ce
 * qui se compte à la pièce monte à l'unité entière. Les cuillerées tolèrent la
 * demie, parce que « une demi-cuillère à café » est un geste réel.
 */
const ROUND_STEPS: Record<Unit, number> = {
  g: 5,
  kg: 0.05,
  ml: 5,
  cl: 0.5,
  l: 0.05,
  piece: 1,
  cas: 0.5,
  cac: 0.5,
  pincee: 1,
  botte: 1,
  gousse: 1,
};

/**
 * Arrondit une quantité **vers le haut**, au pas de son unité.
 *
 * Toujours vers le haut, jamais au plus proche : ce qui est acheté doit couvrir
 * ce qui est cuisiné. Manquer 40 g de riz un dimanche après-midi coûte une
 * course ; en avoir 40 g de trop ne coûte rien.
 *
 * À appeler **une seule fois, sur le total agrégé**. Arrondir chaque recette
 * avant de les additionner empilerait un demi-pas d'erreur par recette, et
 * quatre plats du batch suffiraient à acheter un oignon de trop.
 *
 * L'epsilon protège du flottant : `225` obtenu par `300 * 6 / 8` peut valoir
 * `225.00000000000003`, et un `ceil` naïf le ferait alors monter à 230.
 */
export function roundUpQuantity(qty: number, unit: Unit): number {
  const step = ROUND_STEPS[unit];
  const steps = Math.ceil(qty / step - 1e-9);
  return round(steps * step, 2);
}
