/**
 * Vérifie la chaîne de génération sans rien déployer.
 *
 * Envoie à Gemini exactement ce que `generateWeeklyPlan` enverrait, puis fait
 * traverser la réponse les deux mêmes filtres — schéma Zod, puis contraintes de
 * la semaine type. Un changement de modèle ou de `responseSchema` se valide
 * ainsi en quelques secondes, au lieu d'un cycle de déploiement suivi d'une
 * attente d'ingestion des logs.
 *
 * L'API refuse certaines constructions de schéma avec un « Request contains an
 * invalid argument » qui ne nomme pas le champ fautif, et publie des modèles
 * fermés aux comptes récents : dans les deux cas, seul un appel réel tranche.
 *
 *   GEMINI_API_KEY=… npm run gemini:probe -w functions
 *   GEMINI_API_KEY=… npm run gemini:probe -w functions -- gemini-3.8-flash
 */
import {
  GeneratedPlanSchema,
  getPlanningWeekId,
  validateGeneratedPlan,
} from '@dimanche-batch/shared';
import { GEMINI_MODEL } from '../src/config';
import { SYSTEM_INSTRUCTION, buildPlanPrompt } from '../src/gemini/prompt';
import { WEEKLY_PLAN_RESPONSE_SCHEMA } from '../src/gemini/response-schema';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY manquante. Elle n’est jamais lue depuis un fichier du dépôt :');
  console.error('  GEMINI_API_KEY=… npm run gemini:probe -w functions');
  process.exit(1);
}

const model = process.argv[2] ?? GEMINI_MODEL;
const weekStart = getPlanningWeekId();

const body = {
  contents: [{ parts: [{ text: buildPlanPrompt({ weekStart, recentRecipeNames: [] }) }] }],
  systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: WEEKLY_PLAN_RESPONSE_SCHEMA,
    temperature: 0.7,
  },
};

console.log(`modèle   : ${model}`);
console.log(`semaine  : ${weekStart}\n`);

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  },
);

const payload = (await response.json()) as {
  error?: { message?: string };
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

if (!response.ok) {
  console.error(`❌ API : ${response.status} — ${payload.error?.message ?? 'erreur inconnue'}`);
  console.error('\nUn 400 sans champ nommé vient presque toujours du responseSchema.');
  console.error('Un 404 signale un modèle fermé aux comptes récents, même s’il est listé.');
  process.exit(1);
}

const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
console.log(`✅ API : réponse reçue (${text.length} caractères)`);

let parsedJson: unknown;
try {
  parsedJson = JSON.parse(text);
} catch {
  console.error('❌ JSON illisible.');
  process.exit(1);
}

const parsed = GeneratedPlanSchema.safeParse(parsedJson);
if (!parsed.success) {
  console.error('❌ Schéma Zod refusé :');
  for (const issue of parsed.error.issues.slice(0, 10)) {
    console.error(`   ${issue.path.join('.') || 'racine'} : ${issue.message}`);
  }
  process.exit(1);
}
console.log(`✅ Schéma : ${parsed.data.recipes.length} recettes, ${parsed.data.days.length} jours`);

const violations = validateGeneratedPlan(parsed.data);
if (violations.length > 0) {
  console.error(`⚠️  Contraintes : ${violations.length} violation(s) — la reprise serait déclenchée`);
  for (const violation of violations) console.error(`   [${violation.code}] ${violation.message}`);
  process.exit(1);
}

console.log('✅ Contraintes de la semaine type respectées\n');
for (const recipe of parsed.data.recipes) {
  console.log(
    `   ${recipe.name} — ${recipe.servings} portions, ${recipe.prepMinutes} min [${recipe.tags.join(', ')}]`,
  );
}
