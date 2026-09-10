/**
 * Formatage et normalisation de texte.
 *
 * Les noms d'ingrédients et de recettes sont stockés en minuscules — c'est ce
 * qui permet de les regrouper — et remis en forme au moment de l'affichage.
 * Une seule implémentation, sinon chaque écran finit par avoir la sienne.
 */

/** Première lettre en majuscule, le reste inchangé. */
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Ramène un nom à une forme comparable : minuscules, accents retirés, espaces
 * compactés. « Oignon Rouge » et « oignon rouge » doivent tomber sur la même
 * ligne de courses, « Curry de Lentilles » et « curry de lentilles » sur le
 * même plat banni.
 *
 * C'est une égalité, pas un rapprochement : deux noms qui se ressemblent sans
 * être identiques restent distincts. Un rapprochement flou refuserait des
 * recettes légitimes, ce qui coûterait une reprise au foyer.
 */
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
