/**
 * Surface publique des Cloud Functions. Ce fichier ne contient que des exports :
 * toute logique vit dans `callable/`, une function par fichier.
 */

export { joinHousehold } from './callable/join-household';
export { generateWeeklyPlan } from './callable/generate-weekly-plan';
export { regenerateMeal } from './callable/regenerate-meal';
export { setMeal } from './callable/set-meal';
export { swapMeals } from './callable/swap-meals';
export { replaceBatchRecipeCallable as replaceBatchRecipe } from './callable/replace-batch-recipe';
export { removeBatchRecipeCallable as removeBatchRecipe } from './callable/remove-batch-recipe';
export { composeCookingSession } from './callable/compose-cooking-session';
