/**
 * Surface publique des Cloud Functions. Ce fichier ne contient que des exports :
 * toute logique vit dans `callable/`, une function par fichier.
 */

export { joinHousehold } from './callable/join-household';

// J2 — génération du plan de la semaine et régénération d'un repas :
// export { generateWeeklyPlan } from './callable/generate-weekly-plan';
// export { regenerateMeal } from './callable/regenerate-meal';
