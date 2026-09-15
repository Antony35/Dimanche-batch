/**
 * Vérifie les chaînes de génération sans rien déployer.
 *
 * Envoie à Gemini exactement ce que les callables enverraient, puis fait
 * traverser la réponse les deux mêmes filtres — schéma Zod, puis contraintes
 * métier. Un changement de modèle ou de `responseSchema` se valide ainsi en
 * quelques secondes, au lieu d'un cycle de déploiement suivi d'une attente
 * d'ingestion des logs.
 *
 * L'API refuse certaines constructions de schéma avec un « Request contains an
 * invalid argument » qui ne nomme pas le champ fautif, et publie des modèles
 * fermés aux comptes récents : dans les deux cas, seul un appel réel tranche.
 *
 * La clé n'est jamais lue depuis un fichier du dépôt : elle est passée par
 * l'environnement, et la substitution de commande évite de l'afficher.
 *
 *   set -x K (npx firebase functions:secrets:access GEMINI_API_KEY)  # fish
 *   GEMINI_API_KEY=$K npm run gemini:probe          # les deux chaînes
 *   GEMINI_API_KEY=$K npm run gemini:probe -- meal  # une seule
 *   GEMINI_API_KEY=$K npm run gemini:probe -- plan gemini-3.8-flash
 */
import { z } from 'zod';
import {
  GeneratedMealReplacementSchema,
  GeneratedPlanSchema,
  addDays,
  distributePortions,
  getUpcomingWeekId,
  miseEnPlaceGroup,
  requiredSlowCookTag,
  validateGeneratedPlan,
  GeneratedCookingSessionSchema,
  validateBatchRecipeReplacement,
  validateCookingSession,
  validateMealReplacement,
} from '@dimanche-batch/shared';
import { GEMINI_MODEL } from '../src/config';
import {
  MEAL_REPLACEMENT_SYSTEM_INSTRUCTION,
  SYSTEM_INSTRUCTION,
  BATCH_RECIPE_SYSTEM_INSTRUCTION,
  COOKING_SESSION_SYSTEM_INSTRUCTION,
  buildCookingSessionPrompt,
  buildBatchRecipePrompt,
  buildMealReplacementPrompt,
  buildPlanPrompt,
} from '../src/gemini/prompt';
import {
  COOKING_SESSION_RESPONSE_SCHEMA,
  SINGLE_RECIPE_RESPONSE_SCHEMA,
  WEEKLY_PLAN_RESPONSE_SCHEMA,
} from '../src/gemini/response-schema';

const args = process.argv.slice(2);
const CHAINS = new Set(['plan', 'meal', 'batch', 'session']);
const targets = args.filter((arg) => CHAINS.has(arg));
const model = args.find((arg) => !CHAINS.has(arg)) ?? GEMINI_MODEL;
const weekStart = getUpcomingWeekId();
/** Ce que demanderait un foyer par défaut. */
const BATCH_RECIPE_COUNT = 4;
/**
 * Plats végétariens demandés. Non nul à dessein : c'est la consigne que le
 * modèle a le plus de chances de rater, et un compte à zéro ne l'exercerait pas.
 */
const VEGETARIAN_COUNT = 2;
/**
 * Plats bannis envoyés au modèle. La sonde ne peut pas prouver qu'il les
 * respectera toujours, mais elle prouve que la section part, et un retour qui
 * les contiendrait quand même se verrait ici plutôt qu'en production.
 */
const BANNED_RECIPE_NAMES = ['Gratin de chou-fleur', 'Bœuf carottes'];

// Affiché avant le contrôle de la clé : si un argument n'est pas passé comme
// prévu, ça se voit tout de suite plutôt qu'après un appel API inutile.
console.log(`cibles   : ${targets.length > 0 ? targets.join(' + ') : 'plan + meal'}`);
console.log(`modèle   : ${model}`);
console.log(`semaine  : ${weekStart}`);

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('\nGEMINI_API_KEY manquante. Elle n’est jamais lue depuis un fichier du dépôt :');
  console.error(
    '  GEMINI_API_KEY=(npx firebase functions:secrets:access GEMINI_API_KEY) npm run gemini:probe',
  );
  process.exit(1);
}

/**
 * Ce qu'on lit de la réponse brute de l'API. Validé comme toute donnée externe,
 * y compris dans un script : un changement de forme doit se voir, pas passer.
 */
const GeminiPayloadSchema = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })).optional() })
          .optional(),
      }),
    )
    .optional(),
});

/** Appel brut, sans le SDK : c'est le transport que la function utilisera. */
async function callGemini(body: unknown): Promise<unknown> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  const payload = GeminiPayloadSchema.parse(await response.json());

  if (!response.ok) {
    console.error(`❌ API : ${response.status} — ${payload.error?.message ?? 'erreur inconnue'}`);
    console.error('\nUn 400 sans champ nommé vient presque toujours du responseSchema.');
    console.error('Un 404 signale un modèle fermé aux comptes récents, même s’il est listé.');
    process.exit(1);
  }

  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  console.log(`✅ API : réponse reçue (${text.length} caractères)`);

  try {
    return JSON.parse(text) as unknown;
  } catch {
    console.error('❌ JSON illisible.');
    process.exit(1);
  }
}

async function probePlan(): Promise<void> {
  console.log('\n── generateWeeklyPlan ──');

  // La sonde exerce les trois listes de la mémoire du foyer : sans elles, ni la
  // section des favoris ni celle des plats bannis ne seraient envoyées au modèle
  // avant la production.
  const prompt = buildPlanPrompt({
    weekStart,
    batchRecipeCount: BATCH_RECIPE_COUNT,
    vegetarianCount: VEGETARIAN_COUNT,
    recentRecipeNames: ['Gratin de courgettes', 'Blanquette de veau'],
    favoriteRecipeNames: ['Chili sin carne'],
    bannedRecipeNames: BANNED_RECIPE_NAMES,
  });

  const data = await callGemini({
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: WEEKLY_PLAN_RESPONSE_SCHEMA,
      temperature: 0.7,
    },
  });

  const parsed = GeneratedPlanSchema.safeParse(data);
  if (!parsed.success) {
    reportSchemaFailure(parsed.error.issues);
    process.exit(1);
  }
  console.log(
    `✅ Schéma : ${parsed.data.recipes.length} recettes, ${parsed.data.batchRecipeSlugs.length} plats au batch, ${parsed.data.days.length} jours`,
  );

  const violations = validateGeneratedPlan(parsed.data, {
    expectedBatchCount: BATCH_RECIPE_COUNT,
    expectedVegetarianCount: VEGETARIAN_COUNT,
    bannedNames: BANNED_RECIPE_NAMES,
  });
  if (violations.length > 0) {
    console.error(
      `⚠️  Contraintes : ${violations.length} violation(s) — la reprise serait déclenchée`,
    );
    for (const violation of violations)
      console.error(`   [${violation.code}] ${violation.message}`);
    process.exit(1);
  }

  console.log('✅ Contraintes de la semaine type respectées\n');
  console.log(
    `   BATCH DU DIMANCHE — portions attendues : ${distributePortions(BATCH_RECIPE_COUNT).join(', ')}`,
  );
  for (const slug of parsed.data.batchRecipeSlugs) {
    const recipe = parsed.data.recipes.find((candidate) => candidate.slug === slug);
    if (recipe) {
      console.log(
        `   · ${recipe.name} — ${recipe.servings} portions, ${recipe.prepMinutes} min de présence + ${recipe.cookMinutes} min de cuisson [${recipe.tags.join(', ')}]`,
      );
    }
  }
}

async function probeMeal(): Promise<void> {
  // Un samedi, en one-pot : on ne cuisine plus que le week-end, et le style
  // one-pot est le seul qui porte des contraintes vérifiables.
  const dayIndex = 0;
  const style = 'one-pot' as const;
  const date = addDays(weekStart, dayIndex);
  console.log('\n── regenerateMeal ──');

  const data = await callGemini({
    contents: [
      {
        parts: [
          {
            text: buildMealReplacementPrompt({
              dayIndex,
              style,
              slot: 'dinner',
              date,
              currentRecipeName: null,
              otherRecipeNames: ['Curry de lentilles corail', 'Chili sin carne'],
              bannedRecipeNames: BANNED_RECIPE_NAMES,
            }),
          },
        ],
      },
    ],
    systemInstruction: { parts: [{ text: MEAL_REPLACEMENT_SYSTEM_INSTRUCTION }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SINGLE_RECIPE_RESPONSE_SCHEMA,
      temperature: 0.7,
    },
  });

  const parsed = GeneratedMealReplacementSchema.safeParse(data);
  if (!parsed.success) {
    reportSchemaFailure(parsed.error.issues);
    process.exit(1);
  }

  const recipe = parsed.data.recipe;
  console.log(`✅ Schéma : « ${recipe.name} », ${recipe.ingredients.length} ingrédients`);

  const violations = validateMealReplacement(recipe, dayIndex, {
    style,
    bannedNames: BANNED_RECIPE_NAMES,
  });
  if (violations.length > 0) {
    console.error(
      `⚠️  Contraintes : ${violations.length} violation(s) — la reprise serait déclenchée`,
    );
    for (const violation of violations)
      console.error(`   [${violation.code}] ${violation.message}`);
    process.exit(1);
  }

  console.log('✅ Contraintes du jour respectées\n');
  console.log(
    `   ${recipe.name} — ${recipe.servings} portions, ${recipe.prepMinutes} min [${recipe.tags.join(', ')}]`,
  );
}

function reportSchemaFailure(issues: Array<{ path: PropertyKey[]; message: string }>): void {
  console.error('❌ Schéma Zod refusé :');
  for (const issue of issues.slice(0, 10)) {
    console.error(`   ${issue.path.join('.') || 'racine'} : ${issue.message}`);
  }
}

/**
 * Remplacement d'un plat du batch : les contraintes les plus dures du projet —
 * portions pour quatre repas, congélation, et le temps qu'il reste dans
 * l'après-midi. C'est la chaîne la plus susceptible d'avoir besoin d'une
 * reprise, donc celle qu'il vaut le mieux exercer avant de déployer.
 */
async function probeBatchRecipe(): Promise<void> {
  console.log('\n── replaceBatchRecipe ──');

  // Le plat remplacé est le seul mijoté : le remplaçant doit reprendre ce rôle,
  // la contrainte la plus récente et la moins éprouvée de cette chaîne.
  const otherBatchRecipes = [
    { name: 'Chili sin carne', tags: ['congelable' as const], cookMinutes: 0 },
  ];
  const replacedRecipe = {
    name: 'Curry de lentilles corail',
    tags: ['mijote' as const],
    cookMinutes: 90,
  };
  const context = {
    servedMeals: 4,
    servedDayIndexes: [5, 6],
    otherBatchMinutes: 120,
    otherBatchRecipes,
    replacedRecipe,
    bannedNames: BANNED_RECIPE_NAMES,
  };

  const data = await callGemini({
    contents: [
      {
        parts: [
          {
            text: buildBatchRecipePrompt({
              currentRecipeName: 'Curry de lentilles corail',
              servedMeals: context.servedMeals,
              needsFreezing: true,
              otherBatchMinutes: context.otherBatchMinutes,
              otherRecipeNames: ['Chili sin carne'],
              requiredSlowCook: requiredSlowCookTag(otherBatchRecipes, replacedRecipe),
              bannedRecipeNames: BANNED_RECIPE_NAMES,
            }),
          },
        ],
      },
    ],
    systemInstruction: { parts: [{ text: BATCH_RECIPE_SYSTEM_INSTRUCTION }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SINGLE_RECIPE_RESPONSE_SCHEMA,
      temperature: 0.7,
    },
  });

  const parsed = GeneratedMealReplacementSchema.safeParse(data);
  if (!parsed.success) {
    reportSchemaFailure(parsed.error.issues);
    process.exit(1);
  }

  const recipe = parsed.data.recipe;
  console.log(`✅ Schéma : « ${recipe.name} », ${recipe.servings} portions`);

  const violations = validateBatchRecipeReplacement(recipe, context);
  if (violations.length > 0) {
    console.error(
      `⚠️  Contraintes : ${violations.length} violation(s) — la reprise serait déclenchée`,
    );
    for (const violation of violations)
      console.error(`   [${violation.code}] ${violation.message}`);
    process.exit(1);
  }

  console.log('✅ Contraintes du batch respectées');
  console.log(
    `   ${recipe.name} — ${recipe.servings} portions, ${recipe.prepMinutes} min [${recipe.tags.join(', ')}]`,
  );
}

/**
 * Session de cuisson : nouveau `responseSchema`, donc à exercer avant tout
 * déploiement. Les étapes mêlent volontairement découpe et cuisson —
 * « Émincer l'oignon et le faire revenir » — : c'est exactement ce que le
 * modèle doit savoir réécrire.
 */
async function probeSession(): Promise<void> {
  console.log('\n── composeCookingSession ──');

  const recipes = [
    {
      id: 'bourguignon',
      name: 'Bœuf bourguignon',
      cookMinutes: 150,
      ingredients: [
        { name: 'bœuf', qty: 800, unit: 'g' as const, aisle: 'boucherie' as const },
        { name: 'carotte', qty: 4, unit: 'piece' as const, aisle: 'fruits-legumes' as const },
        { name: 'oignon', qty: 2, unit: 'piece' as const, aisle: 'fruits-legumes' as const },
        { name: 'vin rouge', qty: 50, unit: 'cl' as const, aisle: 'boissons' as const },
      ],
      steps: [
        'Couper le bœuf en cubes et émincer les oignons.',
        'Faire dorer la viande dans une cocotte.',
        'Éplucher les carottes, les couper en rondelles et les ajouter.',
        'Verser le vin, couvrir et laisser mijoter 2 h 30.',
      ],
    },
    {
      id: 'chili-sin-carne',
      name: 'Chili sin carne',
      cookMinutes: 40,
      ingredients: [
        { name: 'oignon', qty: 1, unit: 'piece' as const, aisle: 'fruits-legumes' as const },
        { name: 'poivron', qty: 2, unit: 'piece' as const, aisle: 'fruits-legumes' as const },
        { name: 'haricot rouge', qty: 400, unit: 'g' as const, aisle: 'epicerie' as const },
        { name: 'huile d’olive', qty: 2, unit: 'cas' as const, aisle: 'epicerie' as const },
      ],
      steps: [
        'Émincer l’oignon et le faire revenir dans l’huile.',
        'Couper le poivron en dés et l’ajouter.',
        'Ajouter les haricots et les tomates, mijoter 40 minutes.',
      ],
    },
  ];

  const prompt = buildCookingSessionPrompt({
    recipes: recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      cookMinutes: recipe.cookMinutes,
      ingredients: recipe.ingredients.map((ingredient) => ({
        name: ingredient.name,
        toCut: miseEnPlaceGroup(ingredient.name, ingredient.aisle) !== null,
      })),
      steps: recipe.steps,
    })),
  });

  const data = await callGemini({
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: COOKING_SESSION_SYSTEM_INSTRUCTION }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: COOKING_SESSION_RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  });

  const parsed = GeneratedCookingSessionSchema.safeParse(data);
  if (!parsed.success) {
    reportSchemaFailure(parsed.error.issues);
    process.exit(1);
  }
  console.log(
    `✅ Schéma : ${parsed.data.cuts.length} découpes, ${parsed.data.steps.length} étapes, ${parsed.data.timings.length} temps`,
  );

  const violations = validateCookingSession(parsed.data, recipes);
  if (violations.length > 0) {
    console.error(
      `⚠️  Contraintes : ${violations.length} violation(s) — la reprise serait déclenchée`,
    );
    for (const violation of violations)
      console.error(`   [${violation.code}] ${violation.message}`);
    process.exit(1);
  }

  console.log('✅ Chaque plat a ses étapes, aucune ne redemande de couper\n');
  console.log('   DÉCOUPES');
  for (const cut of parsed.data.cuts)
    console.log(`   · [${cut.recipeId}] ${cut.ingredient} : ${cut.cut}`);
  console.log('\n   TEMPS DE CUISSON SEULE');
  for (const timing of parsed.data.timings)
    console.log(`   · [${timing.recipeId}] ${timing.cookMinutes} min`);
  console.log('\n   ÉTAPES');
  parsed.data.steps.forEach((step, index) => {
    console.log(`   ${String(index + 1).padStart(2)}. [${step.recipeId}] ${step.text}`);
  });
}

if (targets.length === 0 || targets.includes('plan')) await probePlan();
if (targets.length === 0 || targets.includes('meal')) await probeMeal();
if (targets.length === 0 || targets.includes('batch')) await probeBatchRecipe();
if (targets.length === 0 || targets.includes('session')) await probeSession();
