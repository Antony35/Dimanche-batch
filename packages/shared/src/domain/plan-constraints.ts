import type { RecipeTag } from '../schemas/common';
import type { GeneratedPlan, GeneratedRecipe } from '../schemas/gemini';
import type { MealStyle } from '../schemas/weekly-plan';
import { normalizeName } from './text';
import { BATCH_DAY_INDEX, requiresFreezing } from './week';

/**
 * Règles de la semaine type. Un JSON syntaxiquement valide peut décrire un plan
 * inutilisable — un batch qui ne couvre pas la semaine, un plat cuisiné un mardi
 * soir alors que le principe est de ne pas cuisiner en semaine. Ces contraintes
 * sont vérifiées côté Cloud Function avant toute écriture Firestore, et un échec
 * déclenche l'unique retry autorisé, en réinjectant les violations dans le prompt.
 *
 * Les messages sont chiffrés à dessein : c'est ce qui rend une seule reprise
 * suffisante, le modèle sachant alors de combien il s'est trompé.
 */

export interface ConstraintViolation {
  code: string;
  message: string;
}

/** Plats distincts préparés le dimanche. Le foyer choisit dans cet intervalle. */
export const MIN_BATCH_RECIPES = 3;
export const MAX_BATCH_RECIPES = 6;
/** Taille du foyer, en dur en v1. Voir CLAUDE.md §9. */
export const SERVINGS_PER_MEAL = 2;
/** La session du dimanche doit tenir dans un après-midi. */
export const MAX_BATCH_TOTAL_MINUTES = 240;
/** Un one-pot demandé pour le samedi ou le dimanche se prépare en moins de trois quarts d'heure. */
export const MAX_ONE_POT_MINUTES = 45;
/** En deçà, un plat marqué `mijote` ou `four-lent` ne libère pas vraiment le cuisinier. */
export const MIN_SLOW_COOK_MINUTES = 60;
/** Au-delà de ce nombre de plats, le dimanche demande un mijoté **et** un plat au four. */
export const BOTH_SLOW_COOKS_FROM = 5;
/** Repas nourris par le batch : cinq midis et cinq soirs, du lundi au vendredi. */
export const WEEKDAY_MEAL_COUNT = 10;

/**
 * Répartit les repas de la semaine entre les plats du batch.
 *
 * Réparti en **repas** et non en portions, et c'est tout l'intérêt. Diviser 20
 * portions par 3 plats donne 7, 7 et 6 : le plat à 7 portions se mange en trois
 * repas et demi, donc quelqu'un finit avec une demi-assiette. En répartissant
 * les 10 repas — 4, 3 et 3 — chaque plat sert un nombre entier de repas, donc un
 * nombre pair de portions : 8, 6 et 6.
 *
 * Les plus grosses parts d'abord, pour que l'ordre du tableau soit celui qu'on
 * annonce à l'utilisateur avant de générer et celui qu'on impose au modèle.
 *
 * À 6 plats, deux d'entre eux ne servent qu'un repas. C'est beaucoup de cuisine
 * pour deux assiettes, mais c'est un choix que le foyer fait en connaissance :
 * le sélecteur le lui dit.
 */
export function distributeMeals(mealCount: number, dishCount: number): number[] {
  if (dishCount <= 0) return [];

  const base = Math.floor(mealCount / dishCount);
  const remainder = mealCount % dishCount;
  return Array.from({ length: dishCount }, (_, index) => (index < remainder ? base + 1 : base));
}

/** Portions attendues de chaque plat du batch, dans le même ordre. */
export function distributePortions(dishCount: number): number[] {
  return distributeMeals(WEEKDAY_MEAL_COUNT, dishCount).map((meals) => meals * SERVINGS_PER_MEAL);
}

export interface PlanValidationOptions {
  /** Nombre de plats demandé par le foyer avant la génération. */
  expectedBatchCount?: number | undefined;
  /** Nombre de plats végétariens demandé. Absent ou zéro : aucune contrainte. */
  expectedVegetarianCount?: number | undefined;
  /** Noms des plats que le foyer a bannis. Voir `bannedViolations`. */
  bannedNames?: readonly string[] | undefined;
}

/**
 * Vérifie un plan généré : le batch, et les dix repas qu'il nourrit.
 *
 * Le plan ne décrit plus que le lundi au vendredi. Le samedi et le dimanche
 * sont décidés par le foyer après la génération, donc aucune règle ne les
 * concerne ici.
 */
export function validateGeneratedPlan(
  plan: GeneratedPlan,
  options: PlanValidationOptions = {},
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const recipesBySlug = new Map(plan.recipes.map((recipe) => [recipe.slug, recipe]));
  const batchSlugs = new Set(plan.batchRecipeSlugs);

  if (recipesBySlug.size !== plan.recipes.length) {
    violations.push({
      code: 'duplicate-slug',
      message: 'Deux recettes partagent le même slug.',
    });
  }

  const dayIndices = new Set(plan.days.map((day) => day.dayIndex));
  if (dayIndices.size !== 5 || [2, 3, 4, 5, 6].some((index) => !dayIndices.has(index))) {
    violations.push({
      code: 'day-index',
      message: 'Les 5 jours doivent porter les dayIndex 2 à 6 (lundi à vendredi), sans doublon.',
    });
  }

  violations.push(...batchSizeViolations(plan, batchSlugs, options.expectedBatchCount));

  for (const slug of batchSlugs) {
    if (!recipesBySlug.has(slug)) {
      violations.push({
        code: 'batch-unknown-slug',
        message: `Le plat « ${slug} » du batch n'est pas déclaré dans les recettes.`,
      });
    }
  }

  for (const recipe of plan.recipes) {
    if (!batchSlugs.has(recipe.slug)) {
      violations.push({
        code: 'recipe-not-in-batch',
        message: `La recette « ${recipe.name} » n'est pas dans batchRecipeSlugs : seuls les plats du batch sont attendus.`,
      });
    }
  }

  /** Nombre de repas servis par chaque plat du batch, pour vérifier les portions. */
  const servedCount = new Map<string, number>();
  /** Jours où chaque plat du batch est servi, pour la contrainte de congélation. */
  const servedDays = new Map<string, number[]>();

  for (const day of plan.days) {
    for (const [slot, meal] of [
      ['midi', day.lunch],
      ['soir', day.dinner],
    ] as const) {
      const label = `jour ${day.dayIndex} (${slot})`;
      const recipe = recipesBySlug.get(meal.recipeSlug);

      if (!recipe) {
        violations.push({
          code: 'unknown-slug',
          message: `${label} : la recette « ${meal.recipeSlug} » n'est pas déclarée.`,
        });
        continue;
      }
      if (!batchSlugs.has(recipe.slug)) {
        violations.push({
          code: 'leftover-not-from-batch',
          message: `${label} : « ${recipe.name} » est servi en portion mais ne fait pas partie du batch.`,
        });
        continue;
      }

      servedCount.set(recipe.slug, (servedCount.get(recipe.slug) ?? 0) + 1);
      servedDays.set(recipe.slug, [...(servedDays.get(recipe.slug) ?? []), day.dayIndex]);
    }
  }

  for (const slug of batchSlugs) {
    const recipe = recipesBySlug.get(slug);
    if (recipe && !servedCount.has(slug)) {
      violations.push({
        code: 'batch-unused',
        message: `« ${recipe.name} » est dans le batch mais ne sert aucun repas.`,
      });
    }
  }

  violations.push(...distributionViolations(servedCount, batchSlugs.size));
  violations.push(...servingsViolations(recipesBySlug, servedCount));
  violations.push(...freezableViolations(recipesBySlug, servedDays));

  const batchRecipes = [...batchSlugs]
    .map((slug) => recipesBySlug.get(slug))
    .filter((recipe): recipe is GeneratedRecipe => recipe !== undefined);

  violations.push(...batchDurationViolations(batchRecipes));
  for (const recipe of batchRecipes) {
    violations.push(...cookTimeViolations(recipe.name, recipe.steps, recipe.cookMinutes));
  }
  violations.push(...slowCookViolations(batchRecipes, batchSlugs.size));
  violations.push(...vegetarianViolations(batchRecipes, options.expectedVegetarianCount));

  const banned = bannedIndex(options.bannedNames);
  for (const recipe of plan.recipes) {
    violations.push(...bannedViolations(recipe, banned));
  }

  return violations;
}

/**
 * Le foyer a explicitement rejeté ce plat, et le modèle le repropose quand même.
 *
 * Le filet est nécessaire parce qu'un modèle ignore parfois une contrainte
 * négative : sans lui, l'utilisateur se verrait servir le plat qu'il vient de
 * refuser, et la fonctionnalité perdrait tout crédit au premier ratage. La
 * violation part dans l'unique reprise de contenu, qui rappelle le nom fautif.
 *
 * La comparaison est une égalité normalisée, jamais un rapprochement flou : un
 * validateur approximatif refuserait des recettes légitimes, et chaque refus
 * coûte une reprise au foyer.
 */
function bannedViolations(recipe: GeneratedRecipe, banned: Set<string>): ConstraintViolation[] {
  if (!banned.has(normalizeName(recipe.name))) return [];

  return [
    {
      code: 'banned-recipe',
      message: `Le foyer a rejeté « ${recipe.name} » : ne propose ni ce plat ni une variante proche.`,
    },
  ];
}

function bannedIndex(names: readonly string[] | undefined): Set<string> {
  return new Set((names ?? []).map(normalizeName));
}

function batchSizeViolations(
  plan: GeneratedPlan,
  batchSlugs: Set<string>,
  expectedBatchCount: number | undefined,
): ConstraintViolation[] {
  if (batchSlugs.size !== plan.batchRecipeSlugs.length) {
    return [{ code: 'batch-size', message: 'Un plat est déclaré deux fois dans le batch.' }];
  }

  if (expectedBatchCount !== undefined && batchSlugs.size !== expectedBatchCount) {
    return [
      {
        code: 'batch-size',
        message: `Le batch compte ${batchSlugs.size} plats, il en faut exactement ${expectedBatchCount}.`,
      },
    ];
  }

  if (batchSlugs.size < MIN_BATCH_RECIPES || batchSlugs.size > MAX_BATCH_RECIPES) {
    return [
      {
        code: 'batch-size',
        message: `Le batch compte ${batchSlugs.size} plats, il en faut entre ${MIN_BATCH_RECIPES} et ${MAX_BATCH_RECIPES}.`,
      },
    ];
  }

  return [];
}

/**
 * Les repas sont répartis au plus égal entre les plats — 4, 3 et 3 pour trois
 * plats, jamais 5, 3 et 2. C'est ce qu'on a annoncé au foyer avant de générer,
 * et un plat servi cinq fois dans la même semaine est un plat dont on se lasse.
 */
function distributionViolations(
  servedCount: Map<string, number>,
  dishCount: number,
): ConstraintViolation[] {
  if (dishCount === 0 || servedCount.size !== dishCount) return [];

  const actual = [...servedCount.values()].sort((a, b) => b - a);
  const expected = distributeMeals(WEEKDAY_MEAL_COUNT, dishCount);
  if (actual.join(',') === expected.join(',')) return [];

  return [
    {
      code: 'batch-distribution',
      message: `Les dix repas sont répartis ${actual.join(', ')} entre les plats ; il faut ${expected.join(', ')}.`,
    },
  ];
}

/**
 * Un plat du batch produit **exactement** deux portions par repas qu'il sert.
 *
 * Exactement, et non « au moins » : ce que la recette déclare est ce que l'écran
 * de la recette affiche et ce que le dimanche cuisine. Un curry de 10 portions
 * servi quatre fois laisse un reste que personne n'a prévu de manger.
 */
function servingsViolations(
  recipesBySlug: Map<string, GeneratedRecipe>,
  servedCount: Map<string, number>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const [slug, meals] of servedCount) {
    const recipe = recipesBySlug.get(slug);
    if (!recipe) continue;

    const needed = SERVINGS_PER_MEAL * meals;
    if (recipe.servings !== needed) {
      violations.push({
        code: 'batch-servings',
        message: `« ${recipe.name} » sert ${meals} repas, il doit donc produire exactement ${needed} portions, pas ${recipe.servings}.`,
      });
    }
  }

  return violations;
}

/**
 * Cuisiné le dimanche, mangé le vendredi : cinq jours au frigo. L'étiquette
 * `congelable` est le seul signal dont on dispose sur la conservation, et
 * l'app s'en sert pour dire quand sortir le plat du congélateur.
 */
function freezableViolations(
  recipesBySlug: Map<string, GeneratedRecipe>,
  servedDays: Map<string, number[]>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const [slug, days] of servedDays) {
    const recipe = recipesBySlug.get(slug);
    if (!recipe || recipe.tags.includes('congelable')) continue;

    if (days.some(requiresFreezing)) {
      violations.push({
        code: 'batch-not-freezable',
        message: `« ${recipe.name} » est servi en fin de semaine : il doit porter l'étiquette « congelable ».`,
      });
    }
  }

  return violations;
}

/** Le plafond, dit une seule fois pour les deux chemins qui le vérifient. */
function batchTotalViolations(total: number): ConstraintViolation[] {
  if (total <= MAX_BATCH_TOTAL_MINUTES) return [];
  return [
    {
      code: 'batch-too-long',
      message: `Le batch demande ${total} minutes de présence en cuisine, le dimanche n'en offre que ${MAX_BATCH_TOTAL_MINUTES}. La cuisson sans surveillance (cookMinutes) ne compte pas.`,
    },
  ];
}

/**
 * Seul le temps de présence compte. Un mijoté de trois heures n'occupe le
 * cuisinier que vingt minutes : le compter en entier ferait refuser exactement
 * le plat qui organise le dimanche.
 */
function batchDurationViolations(recipes: readonly GeneratedRecipe[]): ConstraintViolation[] {
  return batchTotalViolations(recipes.reduce((total, recipe) => total + recipe.prepMinutes, 0));
}

const SLOW_COOK_TAGS: ReadonlySet<RecipeTag> = new Set(['mijote', 'four-lent']);

/**
 * Le dimanche s'organise autour d'un plat qui cuit longtemps sans surveillance :
 * pendant qu'il mijote ou qu'il est au four, on prépare les autres.
 *
 * Trois ou quatre plats : au moins un mijoté ou un plat au four. Cinq ou six :
 * un de chaque, parce qu'une seule cocotte ne couvre plus l'après-midi.
 *
 * Une étiquette ne suffit pas à le prouver : un plat marqué `mijote` qui cuit
 * vingt minutes ne libère personne. D'où le plancher de cuisson.
 */
export function slowCookViolations(
  recipes: readonly Pick<GeneratedRecipe, 'name' | 'tags' | 'cookMinutes'>[],
  dishCount: number,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const recipe of recipes) {
    const isSlow = recipe.tags.some((tag) => SLOW_COOK_TAGS.has(tag));
    if (isSlow && recipe.cookMinutes < MIN_SLOW_COOK_MINUTES) {
      violations.push({
        code: 'slow-cook-too-short',
        message: `« ${recipe.name} » est marqué mijoté ou four lent mais ne cuit que ${recipe.cookMinutes} minutes ; il en faut au moins ${MIN_SLOW_COOK_MINUTES}.`,
      });
    }
  }

  const hasMijote = recipes.some((recipe) => recipe.tags.includes('mijote'));
  const hasOven = recipes.some((recipe) => recipe.tags.includes('four-lent'));

  if (dishCount >= BOTH_SLOW_COOKS_FROM) {
    if (!hasMijote || !hasOven) {
      violations.push({
        code: 'batch-slow-cook',
        message: `Avec ${dishCount} plats, le batch doit compter au moins un plat « mijote » ET un plat « four-lent », qui cuisent pendant qu'on prépare les autres.`,
      });
    }
  } else if (!hasMijote && !hasOven) {
    violations.push({
      code: 'batch-slow-cook',
      message: `Le batch doit compter au moins un plat « mijote » ou « four-lent », qui cuit pendant qu'on prépare les autres.`,
    });
  }

  return violations;
}

/** Rayons qui trahissent un plat qui n'est pas végétarien. */
const MEAT_AISLES = new Set(['boucherie', 'poissonnerie']);

/**
 * Le nombre de plats végétariens choisi par le foyer, exactement.
 *
 * L'étiquette est une déclaration du modèle, pas une preuve : un plat marqué
 * végétarien avec des lardons ferait tenir le compte en mentant. Le filet
 * s'appuie sur le rayon, déjà obligatoire sur chaque ingrédient — il ne verra
 * pas un bouillon de volaille rangé en épicerie, mais il arrête le cas grossier.
 */
function vegetarianViolations(
  recipes: readonly GeneratedRecipe[],
  expected: number | undefined,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const vegetarian = recipes.filter((recipe) => recipe.tags.includes('vegetarien'));

  for (const recipe of vegetarian) {
    const meat = recipe.ingredients.find((ingredient) => MEAT_AISLES.has(ingredient.aisle));
    if (meat) {
      violations.push({
        code: 'vegetarian-has-meat',
        message: `« ${recipe.name} » est marqué végétarien mais contient « ${meat.name} » (${meat.aisle}).`,
      });
    }
  }

  if (expected !== undefined && expected > 0 && vegetarian.length !== expected) {
    violations.push({
      code: 'batch-vegetarian-count',
      message: `Le batch compte ${vegetarian.length} plat${vegetarian.length > 1 ? 's' : ''} végétarien${vegetarian.length > 1 ? 's' : ''}, il en faut exactement ${expected}.`,
    });
  }

  return violations;
}

/**
 * Contraintes d'un plat qu'on cuisine sans y passer la journée : une casserole,
 * et moins de trois quarts d'heure.
 */
function onePotViolations(recipe: GeneratedRecipe): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  if (!recipe.tags.includes('one-pot')) {
    violations.push({
      code: 'not-one-pot',
      message: `« ${recipe.name} » doit être un one-pot et porter cette étiquette.`,
    });
  }
  if (recipe.prepMinutes > MAX_ONE_POT_MINUTES) {
    violations.push({
      code: 'one-pot-too-long',
      message: `« ${recipe.name} » demande ${recipe.prepMinutes} min, un one-pot en demande ${MAX_ONE_POT_MINUTES} au plus.`,
    });
  }
  return violations;
}

export interface MealReplacementValidationOptions {
  style?: MealStyle | undefined;
  bannedNames?: readonly string[] | undefined;
}

/**
 * Contraintes d'un plat cuisiné le samedi ou le dimanche.
 *
 * On ne cuisine plus en semaine : les dix repas sont des portions du batch, et
 * les changer passe par un échange ou un reste, jamais par une recette. Seuls
 * les `dayIndex` 0 et 1 sont donc acceptés.
 *
 * Le style `one-pot` impose une casserole et trois quarts d'heure ; `elaborate`
 * ou l'absence de style laissent le champ libre.
 */
export function validateMealReplacement(
  recipe: GeneratedRecipe,
  dayIndex: number,
  options: MealReplacementValidationOptions = {},
): ConstraintViolation[] {
  if (dayIndex !== 0 && dayIndex !== BATCH_DAY_INDEX) {
    return [
      {
        code: 'weekend-only',
        message: `On ne cuisine que le samedi et le dimanche ; le jour ${dayIndex} est nourri par le batch.`,
      },
    ];
  }

  const violations = bannedViolations(recipe, bannedIndex(options.bannedNames));
  if (options.style === 'one-pot') violations.push(...onePotViolations(recipe));
  violations.push(...cookTimeViolations(recipe.name, recipe.steps, recipe.cookMinutes));
  return violations;
}

export interface BatchReplacementContext {
  /** Nombre de repas que le plat remplacé servait — le nouveau doit les couvrir. */
  servedMeals: number;
  /** Index des jours servis, 0 = samedi : décide si la congélation est requise. */
  servedDayIndexes: readonly number[];
  /** Temps de présence des autres plats du batch, qui restent en place. */
  otherBatchMinutes: number;
  /** Étiquettes et cuisson des autres plats, pour la règle du plat qui mijote. */
  otherBatchRecipes: readonly Pick<GeneratedRecipe, 'name' | 'tags' | 'cookMinutes'>[];
  /** Le plat qui sort du batch : décide si la règle du mijoté était tenue avant. */
  replacedRecipe: Pick<GeneratedRecipe, 'name' | 'tags' | 'cookMinutes'>;
  bannedNames?: readonly string[] | undefined;
}

/**
 * Contraintes d'un plat qui prend la place d'un autre dans le batch.
 *
 * Contrairement à `validateMealReplacement`, celles-ci portent sur la
 * composition de la semaine, parce qu'un plat du batch n'occupe pas un créneau
 * mais plusieurs. Les portions sont exactes pour que la recette dise ce qu'on
 * cuisine ; la règle du plat qui mijote est rejouée sur le batch recomposé,
 * sans quoi remplacer le seul mijoté la ferait tomber en silence.
 *
 * Rejouée **seulement si le batch d'origine la tenait**. Un plan composé avant
 * cette règle n'a souvent aucun plat marqué : l'exiger du remplaçant rendrait
 * ces semaines impossibles à modifier, pour une règle que personne ne leur a
 * jamais demandée.
 */
export function validateBatchRecipeReplacement(
  recipe: GeneratedRecipe,
  context: BatchReplacementContext,
): ConstraintViolation[] {
  const bySlug = new Map([[recipe.slug, recipe]]);
  const before = [...context.otherBatchRecipes, context.replacedRecipe];
  const after = [...context.otherBatchRecipes, recipe];
  const ruleHeldBefore = !slowCookViolations(before, before.length).some(
    (violation) => violation.code === 'batch-slow-cook',
  );

  return [
    ...bannedViolations(recipe, bannedIndex(context.bannedNames)),
    ...servingsViolations(bySlug, new Map([[recipe.slug, context.servedMeals]])),
    ...freezableViolations(bySlug, new Map([[recipe.slug, [...context.servedDayIndexes]]])),
    ...batchTotalViolations(context.otherBatchMinutes + recipe.prepMinutes),
    ...cookTimeViolations(recipe.name, recipe.steps, recipe.cookMinutes),
    ...slowCookViolations([recipe], after.length).filter(
      (violation) => violation.code === 'slow-cook-too-short',
    ),
    ...(ruleHeldBefore
      ? slowCookViolations(after, after.length).filter(
          (violation) => violation.code === 'batch-slow-cook',
        )
      : []),
  ];
}

/** Rendu compact des violations, réinjecté dans le prompt lors du retry. */
export function describeViolations(violations: ConstraintViolation[]): string {
  return violations.map((violation) => `- ${violation.message}`).join('\n');
}

/**
 * Ce que le remplaçant d'un plat du batch doit apporter pour que la règle du
 * plat qui cuit seul tienne encore — ou rien, si les autres plats la tiennent
 * déjà, ou si le batch d'origine ne la tenait pas.
 *
 * Sert au prompt : le dire au modèle évite la reprise que
 * `validateBatchRecipeReplacement` déclencherait sinon.
 */
export function requiredSlowCookTag(
  otherRecipes: readonly Pick<GeneratedRecipe, 'name' | 'tags' | 'cookMinutes'>[],
  replacedRecipe: Pick<GeneratedRecipe, 'name' | 'tags' | 'cookMinutes'>,
): 'mijote' | 'four-lent' | 'either' | undefined {
  const dishCount = otherRecipes.length + 1;
  const holds = (recipes: readonly Pick<GeneratedRecipe, 'name' | 'tags' | 'cookMinutes'>[]) =>
    !slowCookViolations(recipes, dishCount).some(
      (violation) => violation.code === 'batch-slow-cook',
    );

  if (!holds([...otherRecipes, replacedRecipe])) return undefined;
  if (holds([...otherRecipes, { name: '', tags: [], cookMinutes: 0 }])) return undefined;
  if (dishCount < BOTH_SLOW_COOKS_FROM) return 'either';
  return otherRecipes.some((recipe) => recipe.tags.includes('mijote')) ? 'four-lent' : 'mijote';
}

/**
 * Durées écrites dans une étape, en minutes : « 2 h 30 », « 1h », « 1 heure 30 »,
 * « 45 minutes », « 40 min ». Une fourchette « 30 à 40 minutes » rend 40, la
 * seule borne suivie d'une unité.
 */
export function parseDurations(text: string): number[] {
  const normalized = normalizeName(text);
  const pattern =
    /(\d+)\s*(?:heures?|h)(?![a-z])\s*(?:(\d{1,2})(?!\d)\s*(?:minutes?|min|mn)?)?|(\d+)\s*(?:minutes?|min|mn)(?![a-z])/g;
  const durations: number[] = [];
  for (const match of normalized.matchAll(pattern)) {
    if (match[1] !== undefined) {
      durations.push(Number(match[1]) * 60 + Number(match[2] ?? 0));
    } else if (match[3] !== undefined) {
      durations.push(Number(match[3]));
    }
  }
  return durations;
}

/** En deçà, une durée écrite est un geste surveillé — « faire dorer 10 min » —, pas une cuisson seule. */
export const MIN_UNATTENDED_STEP_MINUTES = 20;

/**
 * Le temps de cuisson déclaré doit couvrir les durées que les étapes écrivent.
 *
 * Deux chiffres produits séparément — `cookMinutes` et le texte des étapes —
 * finissent par se contredire : une fiche annonçait 60 minutes de cuisson en
 * disant « mijoter 1 h 30 ». Seules les durées de plus de vingt minutes
 * comptent, et une tolérance de 10 % (5 minutes au moins) évite de refuser un
 * arrondi.
 */
export function cookTimeViolations(
  recipeName: string,
  steps: readonly string[],
  cookMinutes: number,
): ConstraintViolation[] {
  const longest = Math.max(
    0,
    ...steps.flatMap(parseDurations).filter((minutes) => minutes > MIN_UNATTENDED_STEP_MINUTES),
  );
  const tolerance = Math.max(5, Math.round(cookMinutes * 0.1));
  if (longest <= cookMinutes + tolerance) return [];

  return [
    {
      code: 'cook-time-mismatch',
      message: `« ${recipeName} » : les étapes indiquent ${formatMinutes(longest)} de cuisson, mais cookMinutes vaut ${cookMinutes}. Fais concorder les deux.`,
    },
  ];
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest}`;
}
