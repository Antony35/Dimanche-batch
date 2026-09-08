import { Type, type Schema } from '@google/genai';
import { AISLES, MEAL_KINDS, RECIPE_TAGS, UNITS } from '@dimanche-batch/shared';

/**
 * Schéma de réponse imposé à Gemini.
 *
 * Il double le schéma Zod de `GeneratedPlanSchema` : le premier contraint la
 * génération, le second vérifie ce qui revient. Les deux sont nécessaires —
 * un modèle peut respecter la forme et produire un contenu absurde, et rien
 * ne garantit qu'il respecte toujours la forme.
 *
 * Les listes de valeurs (rayons, unités, étiquettes) sont importées du domaine
 * partagé plutôt que recopiées : ajouter un rayon dans `shared` le rend
 * disponible au modèle sans qu'on puisse l'oublier ici.
 */

const ingredientSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description: 'Nom de l’ingrédient, en minuscules et au singulier.',
    },
    qty: { type: Type.NUMBER, description: 'Quantité pour le nombre de portions indiqué.' },
    unit: { type: Type.STRING, enum: [...UNITS] },
    aisle: { type: Type.STRING, enum: [...AISLES] },
  },
  required: ['name', 'qty', 'unit', 'aisle'],
  propertyOrdering: ['name', 'qty', 'unit', 'aisle'],
};

const recipeSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    slug: {
      type: Type.STRING,
      description:
        'Identifiant local au plan, en minuscules avec des tirets, ex. "curry-lentilles-corail".',
    },
    name: { type: Type.STRING },
    servings: { type: Type.INTEGER, description: 'Nombre de portions produites par la recette.' },
    prepMinutes: { type: Type.INTEGER },
    tags: { type: Type.ARRAY, items: { type: Type.STRING, enum: [...RECIPE_TAGS] }, minItems: '1' },
    ingredients: { type: Type.ARRAY, items: ingredientSchema, minItems: '1' },
    steps: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: '1' },
  },
  required: ['slug', 'name', 'servings', 'prepMinutes', 'tags', 'ingredients', 'steps'],
  propertyOrdering: ['slug', 'name', 'servings', 'prepMinutes', 'tags', 'ingredients', 'steps'],
};

const mealSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    recipeSlug: {
      type: Type.STRING,
      nullable: true,
      description: 'Slug d’une recette déclarée dans `recipes`, ou null si le repas est pris dehors.',
    },
    kind: { type: Type.STRING, enum: [...MEAL_KINDS] },
    withStarter: { type: Type.BOOLEAN, description: 'Entrée légère servie avant le plat.' },
    withDessert: { type: Type.BOOLEAN, description: 'Dessert simple, typiquement un yaourt.' },
  },
  required: ['recipeSlug', 'kind', 'withStarter', 'withDessert'],
  propertyOrdering: ['recipeSlug', 'kind', 'withStarter', 'withDessert'],
};

const daySchema: Schema = {
  type: Type.OBJECT,
  properties: {
    dayIndex: { type: Type.INTEGER, description: '0 = lundi, 6 = dimanche.' },
    lunch: mealSchema,
    dinner: mealSchema,
  },
  required: ['dayIndex', 'lunch', 'dinner'],
  propertyOrdering: ['dayIndex', 'lunch', 'dinner'],
};

export const WEEKLY_PLAN_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    recipes: { type: Type.ARRAY, items: recipeSchema, minItems: '3', maxItems: '12' },
    days: { type: Type.ARRAY, items: daySchema, minItems: '7', maxItems: '7' },
  },
  required: ['recipes', 'days'],
  propertyOrdering: ['recipes', 'days'],
};

/** Régénération d'un seul repas : une recette, sans le plan autour. */
export const SINGLE_RECIPE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { recipe: recipeSchema },
  required: ['recipe'],
};
