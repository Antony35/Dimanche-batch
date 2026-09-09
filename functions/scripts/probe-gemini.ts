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
import {
  GeneratedMealReplacementSchema,
  GeneratedPlanSchema,
  addDays,
  getUpcomingWeekId,
  validateGeneratedPlan,
  validateMealReplacement,
} from '@dimanche-batch/shared';
import { GEMINI_MODEL } from '../src/config';
import {
  MEAL_REPLACEMENT_SYSTEM_INSTRUCTION,
  SYSTEM_INSTRUCTION,
  buildMealReplacementPrompt,
  buildPlanPrompt,
} from '../src/gemini/prompt';
import {
  SINGLE_RECIPE_RESPONSE_SCHEMA,
  WEEKLY_PLAN_RESPONSE_SCHEMA,
} from '../src/gemini/response-schema';

const args = process.argv.slice(2);
const targets = args.filter((arg) => arg === 'plan' || arg === 'meal');
const model = args.find((arg) => arg !== 'plan' && arg !== 'meal') ?? GEMINI_MODEL;
const weekStart = getUpcomingWeekId();
/** Ce que demanderait un foyer par défaut. */
const BATCH_RECIPE_COUNT = 4;

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

interface GeminiPayload {
  error?: { message?: string };
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

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

  const payload = (await response.json()) as GeminiPayload;

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

  // La sonde exerce les deux listes de la mémoire du foyer : sans elles, la
  // section des favoris ne serait jamais envoyée au modèle avant la production.
  const prompt = buildPlanPrompt({
    weekStart,
    batchRecipeCount: BATCH_RECIPE_COUNT,
    recentRecipeNames: ['Gratin de courgettes', 'Blanquette de veau'],
    favoriteRecipeNames: ['Chili sin carne'],
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

  const violations = validateGeneratedPlan(parsed.data, BATCH_RECIPE_COUNT);
  if (violations.length > 0) {
    console.error(`⚠️  Contraintes : ${violations.length} violation(s) — la reprise serait déclenchée`);
    for (const violation of violations) console.error(`   [${violation.code}] ${violation.message}`);
    process.exit(1);
  }

  console.log('✅ Contraintes de la semaine type respectées\n');
  console.log('   BATCH DU DIMANCHE');
  for (const slug of parsed.data.batchRecipeSlugs) {
    const recipe = parsed.data.recipes.find((candidate) => candidate.slug === slug);
    if (recipe) {
      console.log(
        `   · ${recipe.name} — ${recipe.servings} portions, ${recipe.prepMinutes} min [${recipe.tags.join(', ')}]`,
      );
    }
  }
  console.log('\n   CUISINÉ LE JOUR MÊME');
  for (const recipe of parsed.data.recipes) {
    if (parsed.data.batchRecipeSlugs.includes(recipe.slug)) continue;
    console.log(
      `   · ${recipe.name} — ${recipe.servings} portions, ${recipe.prepMinutes} min [${recipe.tags.join(', ')}]`,
    );
  }
}

async function probeMeal(): Promise<void> {
  // Un mardi : le jour où les contraintes de semaine s'appliquent vraiment.
  const dayIndex = 1;
  const date = addDays(weekStart, dayIndex);
  console.log('\n── regenerateMeal ──');

  const data = await callGemini({
    contents: [
      {
        parts: [
          {
            text: buildMealReplacementPrompt({
              dayIndex,
              slot: 'dinner',
              date,
              currentRecipeName: 'Soupe de poireaux',
              otherRecipeNames: ['Curry de lentilles corail', 'Chili sin carne'],
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

  const violations = validateMealReplacement(recipe, dayIndex);
  if (violations.length > 0) {
    console.error(`⚠️  Contraintes : ${violations.length} violation(s) — la reprise serait déclenchée`);
    for (const violation of violations) console.error(`   [${violation.code}] ${violation.message}`);
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

if (targets.length === 0 || targets.includes('plan')) await probePlan();
if (targets.length === 0 || targets.includes('meal')) await probeMeal();
