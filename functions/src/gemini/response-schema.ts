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
 *
 * AUCUN `minItems` / `maxItems` ici. L'API les refuse avec un
 * « Request contains an invalid argument » qui ne nomme pas le champ fautif —
 * vérifié empiriquement avec `npm run gemini:probe`. La cardinalité n'est pas
 * perdue pour autant : elle est imposée par `GeneratedPlanSchema` côté Zod et
 * par `validateGeneratedPlan`, qui font autorité de toute façon. Le schéma ne
 * fait que guider la génération ; il ne garantit rien.
 *
 * Ce que le schéma ne peut plus exprimer est donc dit en toutes lettres dans
 * les `description`, que le modèle lit.
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
    servings: {
      type: Type.INTEGER,
      description:
        'Portions produites. Un plat du batch doit en produire deux par repas qu’il sert.',
    },
    prepMinutes: { type: Type.INTEGER },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: [...RECIPE_TAGS] },
      description: 'Au moins une étiquette.',
    },
    ingredients: {
      type: Type.ARRAY,
      items: ingredientSchema,
      description: 'Au moins un ingrédient, quantifié pour le nombre de portions indiqué.',
    },
    steps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Cinq à huit étapes courtes, à l’infinitif.',
    },
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
      description:
        'Slug d’une recette déclarée dans `recipes`, ou null si le repas est pris dehors.',
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
    dayIndex: {
      type: Type.INTEGER,
      description:
        'La semaine va du samedi au vendredi : 0 = samedi, 1 = dimanche, 2 = lundi, 6 = vendredi.',
    },
    lunch: mealSchema,
    dinner: mealSchema,
  },
  required: ['dayIndex', 'lunch', 'dinner'],
  propertyOrdering: ['dayIndex', 'lunch', 'dinner'],
};

export const WEEKLY_PLAN_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    recipes: {
      type: Type.ARRAY,
      items: recipeSchema,
      description: 'Entre 3 et 12 recettes, toutes utilisées dans le batch ou par un repas.',
    },
    batchRecipeSlugs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Slugs des plats préparés le dimanche, dans l’ordre où il faut les cuisiner. Ils nourrissent les dix repas du lundi au vendredi.',
    },
    days: {
      type: Type.ARRAY,
      items: daySchema,
      description: 'Exactement 7 entrées, du samedi au vendredi, dayIndex 0 à 6 sans doublon.',
    },
  },
  required: ['recipes', 'batchRecipeSlugs', 'days'],
  propertyOrdering: ['recipes', 'batchRecipeSlugs', 'days'],
};

/** Régénération d'un seul repas : une recette, sans le plan autour. */
export const SINGLE_RECIPE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: { recipe: recipeSchema },
  required: ['recipe'],
};

/**
 * Déroulé entrelacé du dimanche. Des étapes plates, chacune rattachée aux plats
 * qu'elle concerne — aucun objet imbriqué de plus, pour la même raison qu'au
 * début de ce fichier : l'API refuse certaines constructions sans nommer le
 * champ fautif. La couverture de chaque plat est vérifiée côté validateur.
 */
export const BATCH_SCHEDULE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    steps: {
      type: Type.ARRAY,
      description: 'Toutes les étapes du dimanche, dans l’ordre où les faire.',
      items: {
        type: Type.OBJECT,
        properties: {
          recipeIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Identifiants des plats que cette étape concerne — un ou plusieurs.',
          },
          text: { type: Type.STRING, description: 'L’étape, courte, à l’infinitif.' },
        },
        required: ['recipeIds', 'text'],
        propertyOrdering: ['recipeIds', 'text'],
      },
    },
  },
  required: ['steps'],
};
