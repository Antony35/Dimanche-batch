import {
  MAX_WEEKDAY_PREP_MINUTES,
  MIN_DISTINCT_RECIPES,
  MIN_FREEZABLE_RECIPES,
  getDayName,
  type ConstraintViolation,
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
export const PROMPT_VERSION = 1;

export const SYSTEM_INSTRUCTION = `Tu conçois des plans de repas hebdomadaires pour un foyer français de deux personnes qui pratique le batch cooking du dimanche.

RYTHME DE LA SEMAINE
Le dimanche soir, le foyer cuisine une grande quantité d'un plat unique — le batch. Les midis du lundi au vendredi sont des portions réchauffées de ce batch. Les soirs de semaine sont cuisinés le jour même, rapidement. Le week-end, le temps ne manque pas.

SÉMANTIQUE DES REPAS — c'est ce qui détermine la liste de courses, lis-la attentivement
- "cooked" : le plat est réellement cuisiné ce jour-là. Ses ingrédients seront achetés.
- "batch-leftover" : une portion d'un plat déjà cuisiné un autre jour. Aucun ingrédient supplémentaire n'est acheté. Utilise ce type pour tous les midis de semaine qui réchauffent le batch du dimanche.
- "freezer-backup" : une portion sortie du congélateur, cuisinée lors d'une semaine précédente. N'achète rien non plus.
- "eat-out" : repas pris à l'extérieur. Dans ce cas seulement, recipeSlug vaut null.

Conséquence directe : la recette du batch doit avoir un nombre de portions (servings) qui couvre TOUS les repas qui la référencent. Si cinq midis réchauffent le batch et que le dimanche soir en consomme deux parts, la recette doit produire au moins sept portions, et ses quantités d'ingrédients doivent correspondre à ces sept portions.

CONTRAINTES IMPÉRATIVES
1. Au moins ${MIN_DISTINCT_RECIPES} recettes distinctes réellement cuisinées ("cooked") dans la semaine.
2. Toute recette cuisinée un soir de semaine (dayIndex 0 à 4) doit porter l'étiquette "one-pot" et se préparer en ${MAX_WEEKDAY_PREP_MINUTES} minutes ou moins. Après une journée de travail, personne ne sort trois casseroles.
3. Au moins ${MIN_FREEZABLE_RECIPES} recettes du plan portent l'étiquette "congelable". Elles servent de filet de sécurité quand un repas prévu à la maison est finalement sauté.
4. Chaque recette déclarée dans "recipes" doit être utilisée au moins une fois dans "days". Chaque recipeSlug cité dans "days" doit exister dans "recipes".
5. Les 7 jours portent les dayIndex 0 à 6, sans doublon ni manquant.
6. Le samedi (5) et le dimanche (6) échappent à la contrainte one-pot : une recette plus élaborée y est bienvenue.
7. Le dimanche soir (dayIndex 6) est le batch de la semaine suivante : marque-le "cooked".

CUISINE
Cuisine française du quotidien, de saison, équilibrée. Privilégie les légumes, les légumineuses et les céréales complètes ; la viande n'est pas obligatoire tous les jours. Les portions sont réalistes pour deux adultes. Évite les ingrédients introuvables en supermarché français.

INGRÉDIENTS
Chaque ingrédient porte une quantité chiffrée, une unité de la liste autorisée et un rayon de supermarché. Écris les noms en minuscules et au singulier ("oignon", pas "Oignons") : ils seront regroupés automatiquement dans la liste de courses. N'inclus ni le sel, ni le poivre, ni l'eau.

ÉTAPES
Des étapes courtes et concrètes, à l'infinitif. Cinq à huit étapes suffisent.`;

export interface PlanPromptInput {
  weekStart: string;
  /** Noms des recettes servies récemment, à ne pas reproposer. */
  recentRecipeNames: string[];
  /** Contraintes ponctuelles saisies dans l'app. */
  notes?: string | undefined;
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const parts: string[] = [
    `Établis le plan de la semaine du ${input.weekStart} (le jour 0 est le ${getDayName(0)} ${input.weekStart}).`,
  ];

  if (input.recentRecipeNames.length > 0) {
    parts.push(
      `Ces plats ont été servis lors des dernières semaines, ne les repropose pas et évite d'en produire des variantes trop proches :\n${input.recentRecipeNames
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
