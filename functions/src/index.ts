/**
 * Surface publique des Cloud Functions. Ce fichier ne contient que des exports :
 * toute logique vit dans `callable/`, une function par fichier.
 */

export { joinHousehold } from './callable/join-household';
export { generateWeeklyPlan } from './callable/generate-weekly-plan';
export { regenerateMeal } from './callable/regenerate-meal';
export { setMeal } from './callable/set-meal';
export { replaceBatchRecipeCallable as replaceBatchRecipe } from './callable/replace-batch-recipe';
