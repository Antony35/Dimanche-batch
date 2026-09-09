/**
 * Formatage de texte affiché.
 *
 * Les noms d'ingrédients et de recettes sont stockés en minuscules — c'est ce
 * qui permet de les regrouper — et remis en forme au moment de l'affichage.
 * Une seule implémentation, sinon chaque écran finit par avoir la sienne.
 */

/** Première lettre en majuscule, le reste inchangé. */
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
