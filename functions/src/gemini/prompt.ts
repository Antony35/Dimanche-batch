import {
  BOTH_SLOW_COOKS_FROM,
  MAX_BATCH_TOTAL_MINUTES,
  MAX_ONE_POT_MINUTES,
  MIN_SLOW_COOK_MINUTES,
  SERVINGS_PER_MEAL,
  describeSeasonalProduce,
  describeViolations,
  distributeMeals,
  formatWeekRange,
  getDayName,
  WEEKDAY_MEAL_COUNT,
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
 *
 * Version 8 : le plan n'est plus que le batch. Le modèle ne décrit ni le samedi
 * ni le dimanche, ne choisit plus ses portions — elles lui sont données plat par
 * plat —, et reçoit le nombre de plats végétariens, la règle du plat qui cuit
 * seul et les légumes du mois.
 *
 * Version 9 : la session du dimanche n'est plus un déroulé fusionné. Le modèle
 * rend, pour chaque plat, la découpe de chaque ingrédient et les seules étapes
 * de cuisson et de mélange — la mise en place est faite avant, d'un coup.
 *
 * Version 10 : les durées écrites dans les étapes et le temps de cuisson
 * déclaré doivent concorder, à la génération comme dans la session, qui rend
 * désormais son propre temps par plat.
 */
export const PROMPT_VERSION = 10;

/**
 * Exigences portant sur une recette, indépendamment du contexte qui la demande.
 * Partagé par la génération d'une semaine et par le remplacement d'un repas.
 */
const RECIPE_STYLE = `CUISINE
Cuisine française du quotidien, de saison, équilibrée. Privilégie les légumes, les légumineuses et les céréales complètes ; la viande n'est pas obligatoire tous les jours. Les portions sont réalistes pour deux adultes. Évite les ingrédients introuvables en supermarché français. Le foyer vit en région Centre-Val de Loire : privilégie les fruits et légumes qui y sont de saison.

ÉTIQUETTES
- "vegetarien" : ni viande ni poisson, ni aucun ingrédient des rayons boucherie ou poissonnerie.
- "mijote" : cuit longtemps à couvert sur le feu sans surveillance (au moins ${MIN_SLOW_COOK_MINUTES} minutes de cuisson).
- "four-lent" : cuit longtemps au four sans surveillance (au moins ${MIN_SLOW_COOK_MINUTES} minutes de cuisson).
- "congelable" : se congèle et se réchauffe sans perdre sa texture.

TEMPS
"prepMinutes" est le temps de PRÉSENCE en cuisine : éplucher, découper, saisir, surveiller. "cookMinutes" est le temps de cuisson SANS surveillance — la cocotte qui mijote, le four qui tourne ; 0 s'il n'y en a pas. Les durées écrites dans les étapes CONCORDENT avec "cookMinutes" : une étape « laisser mijoter 1 h 30 » impose un "cookMinutes" d'au moins 90.

INGRÉDIENTS
Chaque ingrédient porte une quantité chiffrée, une unité de la liste autorisée et un rayon de supermarché. Écris les noms en minuscules et au singulier ("oignon", pas "Oignons") : ils seront regroupés automatiquement dans la liste de courses. N'inclus ni le sel, ni le poivre, ni l'eau.

ÉTAPES
Des étapes courtes et concrètes, à l'infinitif. Cinq à huit étapes suffisent.`;

export const SYSTEM_INSTRUCTION = `Tu conçois le batch cooking du dimanche d'un foyer français de deux personnes : les plats préparés en une session le dimanche, et la façon dont ils nourrissent les dix repas de la semaine.

RYTHME DE LA SEMAINE — c'est le principe de l'application, lis-le attentivement
La semaine va du samedi au vendredi. Le dimanche, le foyer prépare le BATCH : plusieurs grands plats en une seule session de cuisine. Du lundi au vendredi, ON NE CUISINE PAS : les dix repas — cinq midis et cinq soirs — sont des portions du batch, réchauffées. Le samedi et le dimanche ne te concernent pas : le foyer les décide lui-même.
Tu décris uniquement les jours du lundi au vendredi, avec les dayIndex 2 (lundi), 3 (mardi), 4 (mercredi), 5 (jeudi), 6 (vendredi).

CE QUE TU PRODUIS
- "recipes" : les plats du batch, et eux seuls.
- "batchRecipeSlugs" : les mêmes plats, DANS L'ORDRE où il faut les cuisiner — le plat qui cuit le plus longtemps en premier.
- "days" : les 5 jours du lundi au vendredi. Chaque repas est de type "batch-leftover" et pointe vers un plat du batch.

PORTIONS — elles te sont imposées, ne les calcule pas
Le foyer compte ${SERVINGS_PER_MEAL} personnes, donc ${SERVINGS_PER_MEAL} portions par repas. Le message te dit combien de repas sert chaque plat : un plat servi à N repas déclare EXACTEMENT ${SERVINGS_PER_MEAL}×N portions, et ses quantités d'ingrédients correspondent à ce total.

CONTRAINTES IMPÉRATIVES
1. Le nombre de plats, et le nombre de repas servis par chacun, sont exactement ceux du message.
2. Un plat servi le jeudi (5) ou le vendredi (6) porte l'étiquette "congelable" : cuisiné dimanche, il attendrait cinq jours au frigo.
3. La somme des prepMinutes des plats ne dépasse pas ${MAX_BATCH_TOTAL_MINUTES} minutes. La cuisson sans surveillance (cookMinutes) ne compte pas.
4. Le dimanche s'organise autour d'un plat qui cuit seul pendant qu'on prépare les autres : avec 3 ou 4 plats, au moins un plat "mijote" ou "four-lent" ; à partir de ${BOTH_SLOW_COOKS_FROM} plats, au moins un "mijote" ET un "four-lent".
5. Le nombre de plats "vegetarien" est exactement celui du message.
6. Chaque plat se garde et se réchauffe bien : évite ce qui se détrempe, se dessèche ou ne se mange que sortant de la poêle.

${RECIPE_STYLE}`;

/**
 * Instruction système d'une recette cuisinée le samedi ou le dimanche.
 *
 * On ne cuisine plus en semaine : ce prompt ne sert qu'aux deux jours que le
 * foyer décide lui-même. Le bloc commun est partagé plutôt que recopié : deux
 * textes qui doivent dire la même chose finissent toujours par diverger.
 */
export const MEAL_REPLACEMENT_SYSTEM_INSTRUCTION = `Tu proposes une recette cuisinée le jour même, un samedi ou un dimanche, pour un foyer français de deux personnes qui prépare le reste de sa semaine en batch.

Tu ne produis qu'une seule recette, pour un repas de deux portions. Le reste de la semaine est fixé et ne doit pas être remis en cause.

${RECIPE_STYLE}`;

export interface PlanPromptInput {
  weekStart: string;
  /** Nombre de plats à préparer le dimanche, choisi par le foyer. */
  batchRecipeCount: number;
  /** Combien de ces plats sont végétariens. Zéro : aucune contrainte. */
  vegetarianCount: number;
  /** Noms des recettes servies récemment, à ne pas reproposer. */
  recentRecipeNames: string[];
  /**
   * Recettes que le foyer a mises en favori et qui ne sont pas dans
   * `recentRecipeNames`. Sans elles, le bouton favori ne servirait qu'à faire
   * une liste : c'est ici qu'il agit.
   */
  favoriteRecipeNames?: string[] | undefined;
  /**
   * Plats que le foyer a explicitement rejetés. Liste de sens opposé aux deux
   * autres : les récentes s'oublieront dans trois semaines, un plat banni ne
   * revient jamais. C'est la consigne la plus ferme du prompt, et un filet la
   * double côté validation.
   */
  bannedRecipeNames?: string[] | undefined;
}

/** « un plat servi à 4 repas (8 portions), deux plats servis à 3 repas (6 portions) » */
function describeDistribution(dishCount: number): string {
  const groups = new Map<number, number>();
  for (const meals of distributeMeals(WEEKDAY_MEAL_COUNT, dishCount)) {
    groups.set(meals, (groups.get(meals) ?? 0) + 1);
  }
  const words = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six'];
  return [...groups.entries()]
    .map(([meals, count]) => {
      const dishes = `${words[count] ?? count} plat${count > 1 ? 's' : ''}`;
      return `${dishes} servi${count > 1 ? 's' : ''} à ${meals} repas (${meals * SERVINGS_PER_MEAL} portions)`;
    })
    .join(', ');
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const parts: string[] = [
    `Compose le batch de la semaine ${formatWeekRange(input.weekStart)}.`,
    `Le foyer prépare exactement ${input.batchRecipeCount} plats le dimanche. Répartis les ${WEEKDAY_MEAL_COUNT} repas du lundi au vendredi ainsi : ${describeDistribution(input.batchRecipeCount)}.`,
    input.vegetarianCount > 0
      ? `Exactement ${input.vegetarianCount} de ces plats sont végétariens et portent l'étiquette "vegetarien" ; les autres n'en sont pas.`
      : 'Le foyer n’impose aucun nombre de plats végétariens.',
    `Ce qui est de saison ce mois-ci en Centre-Val de Loire, à privilégier :\n${describeSeasonalProduce(input.weekStart)}`,
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

  if (input.bannedRecipeNames && input.bannedRecipeNames.length > 0) {
    parts.push(
      `Le foyer a goûté ces plats et n'en veut plus. Ne les propose sous aucun prétexte, ni eux ni une variante proche :\n${input.bannedRecipeNames
        .map((name) => `- ${name}`)
        .join('\n')}`,
    );
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
    describeViolations(violations),
    'Voici cette proposition, à corriger sans tout réécrire :',
    JSON.stringify(rejectedPlan),
    'Produis un plan complet qui corrige ces points en respectant toutes les contraintes.',
  ].join('\n\n');
}

/**
 * Instruction système du remplacement d'un plat du batch.
 *
 * Différente de celle d'un repas, et pas d'un détail : un plat du batch nourrit
 * plusieurs repas, se cuisine le dimanche et se garde. Les trois contraintes
 * qui suivent sont exactement celles que `validateBatchRecipeReplacement`
 * applique — les dire ici évite une reprise, les taire la garantit.
 */
export const BATCH_RECIPE_SYSTEM_INSTRUCTION = `Tu proposes un plat qui remplace l'un des plats préparés le dimanche, pour un foyer français de deux personnes. Le reste de la semaine est fixé et ne doit pas être remis en cause.

Tu ne produis qu'une seule recette.

CE QU'EST UN PLAT DU BATCH
Il est cuisiné le dimanche en une fois, puis réchauffé les jours suivants. Il doit donc bien se garder et bien se réchauffer : évite ce qui se détrempe, ce qui se dessèche ou ce qui ne se mange que sortant de la poêle.

PORTIONS
Le foyer compte ${SERVINGS_PER_MEAL} personnes, donc ${SERVINGS_PER_MEAL} portions par repas. Ce plat produit EXACTEMENT les portions de tous les repas qu'il sert, et ses quantités d'ingrédients correspondent à ce total.

${RECIPE_STYLE}`;

/**
 * Instruction système de la session de cuisson.
 *
 * Le dimanche se fait en deux temps : on coupe tout d'un coup, puis on cuit les
 * plats l'un après l'autre. Le modèle réécrit donc chaque recette sans ses
 * gestes de découpe, et dit comment couper chaque ingrédient — l'information
 * disparaîtrait sinon avec les étapes qui la portaient. Il n'ordonne rien et ne
 * compte rien : l'ordre et les quantités se calculent.
 */
export const BATCH_SCHEDULE_SYSTEM_INSTRUCTION = `Tu prépares la session de cuisine du dimanche d'un foyer français qui cuisine plusieurs plats d'affilée.

La session se fait en deux temps :
1. MISE EN PLACE — tout ce qui se coupe est coupé d'un coup, avant de cuisiner : oignons, ail, légumes, herbes, viande, poisson.
2. CUISSON — chaque plat est ensuite cuisiné à son tour, avec des ingrédients déjà prêts.

CE QUE TU PRODUIS
- "cuts" : pour chaque ingrédient marqué « à couper », la façon de le couper pour ce plat, en quelques mots : « émincé », « en dés », « haché », « en rondelles », « en cubes de 3 cm ». Reprends le nom de l'ingrédient EXACTEMENT comme la recette l'écrit.
- "steps" : pour chaque plat, les étapes restantes, dans l'ordre, rattachées au plat par son identifiant exact.
- "timings" : pour chaque plat, une seule entrée avec son temps de cuisson sans surveillance en minutes, qui concorde avec les durées que TES étapes écrivent. Si une étape dit « laisser mijoter 2 h 30 », le temps vaut au moins 150. 0 si le plat ne cuit jamais seul.

RÈGLES DES ÉTAPES
- Tout est déjà coupé : aucune étape ne commence par éplucher, émincer, couper, hacher, ciseler, râper, peler, tailler, laver ou trancher. « Émincer l'oignon et le faire revenir » devient « Faire revenir l'oignon ».
- Ne garde que la cuisson et le mélange, sans rien perdre : chaque geste de cuisson de la recette doit se retrouver.
- N'écris aucune quantité : elles sont affichées à côté, pour les portions réellement cuisinées.
- N'invente ni ingrédient ni plat. Chaque plat reçoit au moins une étape.
- Si le plat cuit longtemps sans surveillance, dis-le dans l'étape qui le lance : « Couvrir et laisser mijoter 2 h à feu doux. »

Des étapes courtes, à l'infinitif.`;

export interface BatchSchedulePromptInput {
  recipes: {
    id: string;
    name: string;
    /** Cuisson sans surveillance, pour que l'étape qui la lance le dise. */
    cookMinutes: number;
    ingredients: { name: string; toCut: boolean }[];
    steps: string[];
  }[];
}

export function buildBatchSchedulePrompt(input: BatchSchedulePromptInput): string {
  const recipes = input.recipes.map((recipe) =>
    [
      `PLAT « ${recipe.name} » — identifiant ${recipe.id}${recipe.cookMinutes > 0 ? `, ${recipe.cookMinutes} min de cuisson sans surveillance` : ''}`,
      `Ingrédients :\n${recipe.ingredients
        .map((ingredient) => `- ${ingredient.name}${ingredient.toCut ? ' (à couper)' : ''}`)
        .join('\n')}`,
      `Étapes de la recette :\n${recipe.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    ].join('\n'),
  );
  return [
    `Voici les ${input.recipes.length} plats de ce dimanche. Pour chacun, donne la découpe des ingrédients à couper et les étapes de cuisson restantes.`,
    ...recipes,
  ].join('\n\n');
}

export interface BatchRecipePromptInput {
  /** Plat remplacé, à ne pas reproposer. */
  currentRecipeName: string;
  /** Repas que le nouveau plat devra couvrir. */
  servedMeals: number;
  /** Vrai s'il est servi jeudi ou vendredi : il devra se congeler. */
  needsFreezing: boolean;
  /** Minutes déjà prises par les autres plats du batch. */
  otherBatchMinutes: number;
  /** Autres plats de la semaine, pour ne pas créer de doublon. */
  otherRecipeNames: string[];
  /**
   * Étiquette de cuisson longue que le remplaçant doit porter, quand le plat
   * sortant était le seul à tenir la règle du dimanche.
   */
  requiredSlowCook?: 'mijote' | 'four-lent' | 'either' | undefined;
  bannedRecipeNames?: string[] | undefined;
}

export function buildBatchRecipePrompt(input: BatchRecipePromptInput): string {
  const remaining = MAX_BATCH_TOTAL_MINUTES - input.otherBatchMinutes;
  const parts: string[] = [
    `Remplace « ${input.currentRecipeName} » parmi les plats du dimanche. Propose autre chose, et pas une variante proche.`,
    `Ce plat sert ${input.servedMeals} repas : il doit produire exactement ${SERVINGS_PER_MEAL * input.servedMeals} portions.`,
    `Les autres plats du batch prennent déjà ${input.otherBatchMinutes} minutes : celui-ci doit se préparer en ${remaining} minutes au plus.`,
  ];

  if (input.needsFreezing) {
    parts.push(
      'Il est servi en fin de semaine : il doit se congeler et porter l\'étiquette "congelable".',
    );
  }

  if (input.requiredSlowCook) {
    const label =
      input.requiredSlowCook === 'either'
        ? 'un plat « mijote » ou « four-lent »'
        : `un plat « ${input.requiredSlowCook} »`;
    parts.push(
      `Le plat remplacé était celui qui cuisait seul pendant qu'on prépare les autres : propose ${label}, avec au moins ${MIN_SLOW_COOK_MINUTES} minutes de cuisson sans surveillance.`,
    );
  }

  if (input.otherRecipeNames.length > 0) {
    parts.push(
      `La semaine sert déjà ces plats, n'en produis pas de doublon :\n${input.otherRecipeNames
        .map((name) => `- ${name}`)
        .join('\n')}`,
    );
  }

  if (input.bannedRecipeNames && input.bannedRecipeNames.length > 0) {
    parts.push(
      `Le foyer a goûté ces plats et n'en veut plus. Ne les propose sous aucun prétexte, ni eux ni une variante proche :\n${input.bannedRecipeNames
        .map((name) => `- ${name}`)
        .join('\n')}`,
    );
  }

  return parts.join('\n\n');
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
  /**
   * Plats que le foyer a explicitement rejetés. Liste de sens opposé aux deux
   * autres : les récentes s'oublieront dans trois semaines, un plat banni ne
   * revient jamais. C'est la consigne la plus ferme du prompt, et un filet la
   * double côté validation.
   */
  bannedRecipeNames?: string[] | undefined;
}

export function buildMealReplacementPrompt(input: MealReplacementPromptInput): string {
  const moment = input.slot === 'lunch' ? 'midi' : 'soir';
  const parts: string[] = [
    `Propose une recette pour le ${moment} du ${getDayName(input.dayIndex)} ${input.date}, cuisinée le jour même pour deux portions.`,
  ];

  // Le style demandé prime sur le jour : sans cette phrase, le modèle
  // proposerait un plat élaboré un samedi alors qu'on a demandé du rapide.
  if (input.style === 'one-pot') {
    parts.push(
      `Ce plat doit être un one-pot : une seule casserole, ${MAX_ONE_POT_MINUTES} minutes de préparation au maximum. Donne-lui l'étiquette "one-pot".`,
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

  if (input.bannedRecipeNames && input.bannedRecipeNames.length > 0) {
    parts.push(
      `Le foyer a goûté ces plats et n'en veut plus. Ne les propose sous aucun prétexte, ni eux ni une variante proche :\n${input.bannedRecipeNames
        .map((name) => `- ${name}`)
        .join('\n')}`,
    );
  }

  return parts.join('\n\n');
}
