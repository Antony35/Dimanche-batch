import { Type, type Schema } from '@google/genai';
import { AISLES, RECIPE_TAGS, UNITS } from '@dimanche-batch/shared';

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
        'Portions produites. Un plat du batch en produit exactement deux par repas qu’il sert.',
    },
    prepMinutes: {
      type: Type.INTEGER,
      description: 'Temps de présence en cuisine, en minutes.',
    },
    cookMinutes: {
      type: Type.INTEGER,
      description: 'Temps de cuisson sans surveillance, en minutes. 0 s’il n’y en a pas.',
    },
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
  required: [
    'slug',
    'name',
    'servings',
    'prepMinutes',
    'cookMinutes',
    'tags',
    'ingredients',
    'steps',
  ],
  propertyOrdering: [
    'slug',
    'name',
    'servings',
    'prepMinutes',
    'cookMinutes',
    'tags',
    'ingredients',
    'steps',
  ],
};

const mealSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    recipeSlug: {
      type: Type.STRING,
      description: 'Slug d’un plat du batch déclaré dans `recipes`.',
    },
    kind: {
      type: Type.STRING,
      enum: ['batch-leftover'],
      description: 'Toujours "batch-leftover" : une portion d’un plat du batch.',
    },
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
        'Du lundi au vendredi : 2 = lundi, 3 = mardi, 4 = mercredi, 5 = jeudi, 6 = vendredi.',
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
      description: 'Les plats du batch, et eux seuls : entre 3 et 6, autant que demandé.',
    },
    batchRecipeSlugs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Slugs des plats préparés le dimanche, dans l’ordre où il faut les cuisiner — le plat qui cuit le plus longtemps en premier. Ils nourrissent les dix repas du lundi au vendredi.',
    },
    days: {
      type: Type.ARRAY,
      items: daySchema,
      description: 'Exactement 5 entrées, du lundi au vendredi, dayIndex 2 à 6 sans doublon.',
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
 * Session de cuisson du dimanche : la découpe de chaque ingrédient, puis les
 * étapes de cuisson de chaque plat. Deux listes à plat, rattachées au plat par
 * son identifiant — aucun objet imbriqué de plus, pour la même raison qu'au
 * début de ce fichier. La couverture de chaque plat est vérifiée côté
 * validateur.
 */
export const BATCH_SCHEDULE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    cuts: {
      type: Type.ARRAY,
      description: 'La façon de couper chaque ingrédient marqué « à couper », plat par plat.',
      items: {
        type: Type.OBJECT,
        properties: {
          recipeId: { type: Type.STRING, description: 'Identifiant exact du plat.' },
          ingredient: {
            type: Type.STRING,
            description: 'Nom de l’ingrédient, exactement comme la recette l’écrit.',
          },
          cut: { type: Type.STRING, description: '« émincé », « en dés », « haché »…' },
        },
        required: ['recipeId', 'ingredient', 'cut'],
        propertyOrdering: ['recipeId', 'ingredient', 'cut'],
      },
    },
    steps: {
      type: Type.ARRAY,
      description:
        'Les étapes de cuisson et de mélange de chaque plat, dans l’ordre, sans aucune découpe ni quantité.',
      items: {
        type: Type.OBJECT,
        properties: {
          recipeId: { type: Type.STRING, description: 'Identifiant exact du plat.' },
          text: { type: Type.STRING, description: 'L’étape, courte, à l’infinitif.' },
        },
        required: ['recipeId', 'text'],
        propertyOrdering: ['recipeId', 'text'],
      },
    },
    timings: {
      type: Type.ARRAY,
      description:
        'Pour chaque plat, une entrée : son temps de cuisson sans surveillance, qui concorde avec les durées écrites dans ses étapes.',
      items: {
        type: Type.OBJECT,
        properties: {
          recipeId: { type: Type.STRING, description: 'Identifiant exact du plat.' },
          cookMinutes: {
            type: Type.INTEGER,
            description: 'Minutes de cuisson sans surveillance ; 0 si le plat ne cuit jamais seul.',
          },
        },
        required: ['recipeId', 'cookMinutes'],
        propertyOrdering: ['recipeId', 'cookMinutes'],
      },
    },
  },
  required: ['cuts', 'steps', 'timings'],
  propertyOrdering: ['cuts', 'steps', 'timings'],
};
