import {
  MAX_BATCH_TOTAL_MINUTES,
  MAX_WEEKDAY_PREP_MINUTES,
  SERVINGS_PER_MEAL,
  addDays,
  getDayName,
  type ConstraintViolation,
  type MealSlot,
  type MealStyle,
} from '@dimanche-batch/shared';

/**
 * Prompt de génération, en une seule constante versionnée.
 *
 * Il n'est jamais construit par concaténation dispersée dans le code : quand
 * un plan revient bancal, il faut pouvoir lire d'un coup ce qui a été demandé.
 *
 * Incrémenter PROMPT_VERSION à chaque modification de fond. La version est
 * stockée avec le plan, ce qui permet de savoir quelle formulation a produit
 * quel résultat.
 */
export const PROMPT_VERSION = 4;

/**
 * Exigences portant sur une recette, indépendamment du contexte qui la demande.
 * Partagé par la génération d'une semaine et par le remplacement d'un repas.
 */
const RECIPE_STYLE = `CUISINE
Cuisine française du quotidien, de saison, équilibrée. Privilégie les légumes, les légumineuses et les céréales complètes ; la viande n'est pas obligatoire tous les jours. Les portions sont réalistes pour deux adultes. Évite les ingrédients introuvables en supermarché français.

INGRÉDIENTS
Chaque ingrédient porte une quantité chiffrée, une unité de la liste autorisée et un rayon de supermarché. Écris les noms en minuscules et au singulier ("oignon", pas "Oignons") : ils seront regroupés automatiquement dans la liste de courses. N'inclus ni le sel, ni le poivre, ni l'eau.

ÉTAPES
Des étapes courtes et concrètes, à l'infinitif. Cinq à huit étapes suffisent.`;

export const SYSTEM_INSTRUCTION = `Tu conçois des plans de repas hebdomadaires pour un foyer français de deux personnes qui pratique le batch cooking du dimanche.

RYTHME DE LA SEMAINE — c'est le principe de l'application, lis-le attentivement
La semaine va du SAMEDI au VENDREDI. Les dayIndex suivent cet ordre : 0 samedi, 1 dimanche, 2 lundi, 3 mardi, 4 mercredi, 5 jeudi, 6 vendredi.
- Samedi (0) : les courses sont faites le matin. Les repas de ce jour sont cuisinés le jour même, avec des produits frais.
- Dimanche (1) : le foyer prépare le BATCH — plusieurs grands plats en une seule session de cuisine. Les repas du dimanche sont cuisinés le jour même ou pris sur le batch fraîchement préparé.
- Lundi à vendredi (2 à 6) : ON NE CUISINE PAS. Les dix repas — cinq midis et cinq soirs — sont des portions du batch, réchauffées.

SÉMANTIQUE DES REPAS — c'est ce qui détermine la liste de courses
- "batch-leftover" : une portion d'un plat du batch. C'est le type de TOUS les repas du lundi au vendredi. Le recipeSlug doit être l'un des batchRecipeSlugs.
- "cooked" : le plat est cuisiné ce jour-là. Réservé au samedi et au dimanche. Le recipeSlug ne doit PAS être un plat du batch, qui est déjà acheté.
- "freezer-backup" : une portion sortie du congélateur, cuisinée une semaine précédente. N'achète rien.
- "eat-out" : repas pris à l'extérieur. Dans ce cas seulement, recipeSlug vaut null.

PORTIONS — la contrainte la plus facile à rater
Le foyer compte ${SERVINGS_PER_MEAL} personnes, donc ${SERVINGS_PER_MEAL} portions par repas. Chaque plat du batch doit produire assez de portions pour TOUS les repas qui le servent. Un plat servi quatre repas doit déclarer au moins ${SERVINGS_PER_MEAL * 4} portions, et ses quantités d'ingrédients doivent correspondre à ce total.

CONTRAINTES IMPÉRATIVES
1. Déclare dans "batchRecipeSlugs" les plats préparés le dimanche, DANS L'ORDRE où il faut les cuisiner.
2. Les dix repas du lundi au vendredi sont tous "batch-leftover" et pointent vers un plat du batch.
3. Un plat du batch servi le jeudi (5) ou le vendredi (6) doit porter l'étiquette "congelable" : cuisiné dimanche, il attendrait cinq jours au frigo.
4. La somme des temps de préparation des plats du batch ne dépasse pas ${MAX_BATCH_TOTAL_MINUTES} minutes — le dimanche n'est pas une journée entière de cuisine.
5. Chaque recette déclarée dans "recipes" est utilisée, soit dans le batch, soit par un repas. Chaque recipeSlug cité existe dans "recipes".
6. Les 7 jours portent les dayIndex 0 à 6, sans doublon ni manquant.
7. Le samedi et le dimanche, propose des plats plus élaborés : c'est le moment où l'on prend le temps de cuisiner.

${RECIPE_STYLE}`;

/**
 * Instruction système de la régénération d'un repas isolé.
 *
 * Elle ne reprend pas la structure de la semaine — il n'y a qu'une recette à
 * produire — mais applique la même exigence sur la recette elle-même. Le bloc
 * commun est partagé plutôt que recopié : deux textes qui doivent dire la même
 * chose finissent toujours par diverger.
 */
export const MEAL_REPLACEMENT_SYSTEM_INSTRUCTION = `Tu proposes une recette de remplacement pour un repas dans un plan hebdomadaire déjà établi, pour un foyer français de deux personnes.

Tu ne produis qu'une seule recette. Le reste de la semaine est fixé et ne doit pas être remis en cause.

CONTRAINTE DE SEMAINE
Une recette servie du lundi au vendredi (dayIndex 0 à 4) doit porter l'étiquette "one-pot" et se préparer en ${MAX_WEEKDAY_PREP_MINUTES} minutes ou moins. Après une journée de travail, personne ne sort trois casseroles. Le samedi et le dimanche échappent à cette contrainte.

${RECIPE_STYLE}`;

export interface PlanPromptInput {
  weekStart: string;
  /** Nombre de plats à préparer le dimanche, choisi par le foyer. */
  batchRecipeCount: number;
  /** Noms des recettes servies récemment, à ne pas reproposer. */
  recentRecipeNames: string[];
  /**
   * Recettes que le foyer a mises en favori et qui ne sont pas dans
   * `recentRecipeNames`. Sans elles, le bouton favori ne servirait qu'à faire
   * une liste : c'est ici qu'il agit.
   */
  favoriteRecipeNames?: string[] | undefined;
  /** Contraintes ponctuelles saisies dans l'app. */
  notes?: string | undefined;
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const parts: string[] = [
    `Établis le plan de la semaine du ${input.weekStart} au ${addDays(input.weekStart, 6)} (le jour 0 est le ${getDayName(0)} ${input.weekStart}).`,
    `Le foyer veut préparer exactement ${input.batchRecipeCount} plats le dimanche. Répartis les dix repas du lundi au vendredi entre eux.`,
  ];

  if (input.recentRecipeNames.length > 0) {
    parts.push(
      `Ces plats ont été servis lors des dernières semaines, ne les repropose pas et évite d'en produire des variantes trop proches :\n${input.recentRecipeNames
        .map((name) => `- ${name}`)
        .join('\n')}`,
    );
  }

  if (input.favoriteRecipeNames && input.favoriteRecipeNames.length > 0) {
    // Une seule au plus : le foyer veut revoir ses favoris, pas manger la même
    // chose toutes les semaines. La variété reste la contrainte dominante.
    parts.push(
      `Le foyer a mis ces plats en favori. Tu peux en reprendre un, au maximum, et seulement s'il s'intègre naturellement à la semaine :\n${input.favoriteRecipeNames
        .map((name) => `- ${name}`)
        .join('\n')}`,
    );
  }

  if (input.notes && input.notes.trim().length > 0) {
    parts.push(`Contraintes particulières pour cette semaine :\n${input.notes.trim()}`);
  }

  return parts.join('\n\n');
}

/**
 * Prompt du retry unique.
 *
 * On ne redemande pas la même chose en espérant mieux : on renvoie le plan
 * refusé avec la liste exacte de ce qui ne va pas. C'est ce qui rend une
 * seule reprise suffisante dans la grande majorité des cas.
 */
export function buildRetryPrompt(
  original: string,
  violations: ConstraintViolation[],
  rejectedPlan: unknown,
): string {
  return [
    original,
    'Ta proposition précédente a été refusée pour les raisons suivantes :',
    violations.map((violation) => `- ${violation.message}`).join('\n'),
    'Voici cette proposition, à corriger sans tout réécrire :',
    JSON.stringify(rejectedPlan),
    'Produis un plan complet qui corrige ces points en respectant toutes les contraintes.',
  ].join('\n\n');
}

export interface MealReplacementPromptInput {
  /** 0 = samedi, cohérent avec le contrat Gemini. */
  dayIndex: number;
  /** Style demandé. Absent, il se déduit du jour. */
  style?: MealStyle | undefined;
  slot: MealSlot;
  date: string;
  /** Recette actuellement servie sur ce créneau, à ne pas reproposer. */
  currentRecipeName: string | null;
  /** Autres recettes de la semaine, pour ne pas créer de doublon. */
  otherRecipeNames: string[];
  notes?: string | undefined;
}

export function buildMealReplacementPrompt(input: MealReplacementPromptInput): string {
  const moment = input.slot === 'lunch' ? 'midi' : 'soir';
  const parts: string[] = [
    `Propose une recette pour le ${moment} du ${getDayName(input.dayIndex)} ${input.date} (dayIndex ${input.dayIndex}).`,
  ];

  // Le style demandé prime sur le jour : sans cette phrase, le modèle
  // proposerait un plat élaboré un samedi alors qu'on a demandé du rapide.
  if (input.style === 'one-pot') {
    parts.push(
      `Ce plat doit être un one-pot : une seule casserole, ${MAX_WEEKDAY_PREP_MINUTES} minutes au maximum. Donne-lui l'étiquette "one-pot".`,
    );
  } else if (input.style === 'elaborate') {
    parts.push(
      'Ce plat peut demander du temps et plusieurs ustensiles : le foyer a décidé de cuisiner ce jour-là.',
    );
  }

  if (input.currentRecipeName) {
    parts.push(
      `Le créneau est actuellement occupé par « ${input.currentRecipeName} » : propose autre chose, et pas une variante proche.`,
    );
  }

  if (input.otherRecipeNames.length > 0) {
    parts.push(
      `Le reste de la semaine sert déjà ces plats, n'en produis pas de doublon :\n${input.otherRecipeNames
        .map((name) => `- ${name}`)
        .join('\n')}`,
    );
  }

  if (input.notes && input.notes.trim().length > 0) {
    parts.push(`Contraintes particulières :\n${input.notes.trim()}`);
  }

  return parts.join('\n\n');
}
