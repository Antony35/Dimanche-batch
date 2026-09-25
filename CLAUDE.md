# Dimanche Batch

Application mobile de batch cooking pour un foyer de deux personnes. **On cuisine
le dimanche, on ne cuisine pas de la semaine.** Le foyer choisit combien de plats
préparer (trois à six) et combien sont végétariens ; l'API Gemini compose ce
batch, qui nourrit les dix repas du lundi au vendredi. Le samedi et le dimanche
ne sont pas générés : le foyer les décide ensuite — un reste, un repas dehors, un
plat cuisiné. Le plan devient la liste de courses du foyer, groupée par rayon,
où l'on ajoute aussi ses produits ménagers. Les deux téléphones partagent le
même foyer et voient les mêmes données en temps réel.

**La semaine va du samedi au vendredi**, et c'est structurant : les courses se
font le samedi matin, le batch le dimanche, et tout ce qui se cuisine frais l'est
juste après les courses. Avec une semaine lundi→dimanche, un plat cuisiné le
dernier jour aurait attendu huit jours au frigo.

**Statut : v1 en cours — J1 à J6 livrés, modèle du batch refondu.** Le monorepo, le domaine partagé, les
Security Rules, l'authentification, le foyer partagé, la génération Gemini, le
planning des 7 jours, la régénération d'un repas isolé, la liste de courses, la
fiche recette, l'historique et le fonctionnement hors ligne ; 459 tests couvrent
le domaine, les schémas, les callables et les règles. Reste le build (J7). Ce
document fait autorité sur l'architecture ; il est mis à jour en même temps que
le code, jamais après.

---

## 1. Principes directeurs

Ces règles priment sur toute considération de rapidité. La v1 doit être testable en
une semaine, mais jamais au prix d'une dette qui bloquerait la v2.

1. **Aucun secret dans l'app.** La clé Gemini vit exclusivement dans Secret Manager,
   lue par les Cloud Functions. Tout ce qui est bundlé dans l'APK est public.
   `EXPO_PUBLIC_*` est du texte en clair — n'y mettre que de la configuration non sensible.
2. **Le client ne fait pas confiance à lui-même.** Toute écriture Firestore est
   contrainte par les Security Rules ; tout appel à un service tiers passe par une
   Cloud Function authentifiée.
3. **Les frontières sont validées.** Toute donnée qui entre dans le système (réponse
   Gemini, payload d'une callable, document Firestore lu) traverse un schéma Zod avant
   d'être utilisée. Pas de `as SomeType` sur une donnée externe.
4. **Types partagés, source unique.** Les types du domaine vivent dans
   `packages/shared` et sont importés par l'app comme par les functions. Aucune
   duplication d'interface entre client et serveur.
5. **La logique métier ne vit pas dans les composants.** Un composant React affiche et
   déclenche ; il ne calcule pas d'agrégation, ne parse pas, n'appelle pas Firestore
   directement.
6. **Évolutif par défaut.** Chaque raccourci v1 est documenté en section 9 avec son
   point d'extension. Si tu prends un raccourci non listé, ajoute-le à cette section.

---

## 2. Stack

| Couche        | Choix                                                                                                           | Note                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| App           | Expo (SDK récent) + React Native + TypeScript strict                                                            | Android uniquement en v1                                            |
| Navigation    | Expo Router (file-based)                                                                                        | Routes typées                                                       |
| État serveur  | TanStack Query + listeners Firestore                                                                            | Pas de Redux                                                        |
| État local    | React Context minimal (session, foyer)                                                                          |                                                                     |
| Données       | Firebase Firestore                                                                                              | Temps réel entre les deux téléphones                                |
| Auth          | Firebase Auth — email + mot de passe                                                                            | Importé depuis `@firebase/auth`, pas `firebase/auth` : voir §7      |
| Cache offline | AsyncStorage, explicite (`lib/offline-cache.ts`)                                                                | Le SDK JS Firestore n'a pas de persistance offline sur React Native |
| Backend       | Cloud Functions for Firebase (Node 24, 2ᵉ gén., `firebase-functions` 7), région `europe-west1`                  | Plan Blaze, plafond de dépense à définir                            |
| IA            | Gemini API, appelée **uniquement** depuis les Cloud Functions                                                   |                                                                     |
| Validation    | Zod, partagé client/serveur                                                                                     |                                                                     |
| Tests         | Vitest : domaine pur, callables contre l'émulateur Firestore, Security Rules via `@firebase/rules-unit-testing` | L'émulateur exige un JRE installé — voir §7                         |
| CI            | GitHub Actions, sur chaque push et chaque PR                                                                    | Alerte, ne bloque pas. Aucun secret : le dépôt est public           |
| Lint          | oxlint, config à la racine (`.oxlintrc.json`)                                                                   | Couvre les quatre workspaces, pas seulement `app/`                  |
| Code mort     | knip (`knip.json`), lancé par la CI                                                                             | Fichiers, exports et dépendances que plus personne n'utilise        |
| Format        | oxfmt (`.oxfmtrc.json`)                                                                                         | `singleQuote`, `printWidth: 100`. **Encore en 0.x** — voir §9       |

---

## 3. Structure du dépôt

Monorepo npm workspaces. Ne pas créer de dossier hors de cette arborescence sans
mettre ce document à jour.

```
dimanche-batch/
├─ CLAUDE.md
├─ package.json               # workspaces: app, functions, packages/*
├─ .nvmrc                     # Node 24, source unique lue par la CI
├─ firebase.json              # emulators, rules, functions
├─ firestore.rules
├─ firestore.indexes.json
│
├─ .github/workflows/ci.yml   # typage, lint, format, code mort, les 4 suites
├─ .oxlintrc.json             # lint des quatre workspaces
├─ .oxfmtrc.json              # format
├─ knip.json                  # code mort
├─ renovate.json              # veille des versions, en tableau de bord
│
├─ packages/shared/           # aucun import de firebase, react-native ni node
│  └─ src/
│     ├─ schemas/             # Zod : common, household, recipe, weeklyPlan,
│     │                       #       groceryList, gemini (contrat du modèle)
│     ├─ domain/              # logique pure : semaine, unités, agrégation des
│     │                       #   courses, rayons, saisons, contraintes de plan,
│     │                       #   édition d'un repas, batch, session,
│     │                       #   mise en place, goûts, texte
│     └─ firestore-paths.ts   # chemins Firestore, définis une seule fois
│
├─ packages/rules-tests/       # Security Rules testées contre l'émulateur
│
├─ app/
│  └─ src/
│     ├─ app/                 # routes Expo Router
│     ├─ features/            # auth, household, meal-plan, recipes, grocery-list, history
│     │  └─ <feature>/        # components/, hooks/, api/
│     ├─ components/ui/       # primitives sans logique métier : Text, Button,
│     │                       #   Screen, Card, TextField, Tag, états
│     ├─ lib/                 # env, firebase, callables, query-client, storage
│     └─ theme/               # tokens couleur/typo/espacement, clair + sombre
│
└─ functions/
   └─ src/
      ├─ index.ts             # exports des functions, rien d'autre
      ├─ callable/            # une function par fichier
      ├─ gemini/              # client, prompt, parsing de la réponse
      └─ lib/                 # guards d'auth, accès Firestore admin
```

**Règle d'import :** `app` et `functions` importent depuis `shared`. `shared` n'importe
depuis personne. `app` n'importe jamais depuis `functions` (et inversement).

`shared` n'est jamais installé comme dépendance : il est **compilé dans** ses
consommateurs. `app` en consomme la source TypeScript via la condition d'export
`react-native`, que Metro transpile. `functions` la bundle avec esbuild
(`functions/esbuild.config.mjs`), parce que Cloud Build ne reçoit que le dossier
`functions/` et chercherait `@dimanche-batch/shared` sur le registre npm public.
C'est pourquoi le package n'apparaît ni dans les dépendances ni dans les
dépendances de développement de `functions`, et pourquoi `tsc` n'y sert plus qu'au
typage (`noEmit`), l'artefact étant produit par esbuild.

Les imports internes du package sont sans extension, seule forme que Metro, tsc
et esbuild résolvent de la même manière.

---

## 4. Sécurité de la clé Gemini

C'est la contrainte structurante du projet. Le schéma d'appel est :

```
App ──(callable, token Firebase Auth)──> Cloud Function ──(clé depuis Secret Manager)──> Gemini
                                              │
                                              └──> écriture Firestore (admin SDK)
```

Règles non négociables :

- La clé est déclarée via `defineSecret('GEMINI_API_KEY')` et déployée avec
  `firebase functions:secrets:set GEMINI_API_KEY`. Elle n'apparaît **jamais** dans un
  fichier du dépôt, pas même dans un `.env.example` avec une valeur.
- Aucun appel `fetch` vers `generativelanguage.googleapis.com` depuis `app/`. Si tu en
  écris un, c'est une erreur d'architecture.
- Les functions sont des **callables** (`onCall`) : le token Firebase Auth est vérifié
  par le runtime. Chaque function commence par un guard qui vérifie (a) que l'appelant
  est authentifié, (b) qu'il est membre du `householdId` visé.
- **Rate limiting** obligatoire : un compteur de générations par foyer et par jour,
  stocké dans Firestore et vérifié avant l'appel Gemini. La clé est partagée avec ton
  quota étudiant — une boucle de retry mal écrite coûte cher.
- **App Check** est prévu pour la v1.1 : il empêche les appels provenant d'autre chose
  que ton APK. Non bloquant pour la v1 puisque l'auth couvre déjà l'essentiel, mais
  l'architecture ne doit rien faire qui empêche de l'activer.
- Plafond de dépense Blaze configuré côté console avant le premier déploiement.
  Attention : un budget Google Cloud est une **alerte**, il ne coupe rien. Ce qui
  borne réellement la dépense est ce qui borne l'exécution — `maxInstances`, le
  quota de générations, et les quotas d'API.
- **La clé Gemini appartient à un projet Google Cloud sans facturation**, distinct
  de `dimanche-batch`. Rien n'impose qu'elle vive dans le même projet que Firebase :
  la function la lit depuis Secret Manager, et l'API se moque de l'appelant. Sur un
  projet non facturé, l'usage reste sur le palier gratuit et le coût est nul par
  construction plutôt que par surveillance. Un abonnement Google AI Pro ne couvre
  que l'application Gemini, jamais l'API.

---

## 5. Modèle de données

Tout est imbriqué sous un foyer. Aucune collection racine autre que `households`.

```
households/{householdId}
  members: string[]            # uid Firebase Auth
  inviteCode: string           # court, régénérable, à usage unique
  createdAt: Timestamp

households/{hid}/weeklyPlans/{weekId}      # weekId = date ISO du SAMEDI, ex. 2026-09-12
  weekStart: string
  days: DayPlan[7]             # 0 = samedi … 6 = vendredi
  recipeIds: string[]          # toutes les recettes citées, batch compris
  batchRecipeIds: string[]     # plats préparés le dimanche, dans l'ordre de cuisson
  promptVersion: number
  generatedAt: Timestamp
  generatedBy: string          # uid

households/{hid}/recipes/{recipeId}
  name, servings, prepMinutes, tags[], ingredients[], steps[]
  lastUsedAt: string | null
  isFavorite: boolean
  isDisliked: boolean          # plat rejeté, jamais reproposé par le modèle

households/{hid}/groceryLists/{weekId}
  itemCount: number            # métadonnées seulement

households/{hid}/groceryLists/{weekId}/items/{itemId}
  name, qty, unit, aisle, checked, fromRecipeIds[]
  origin: 'batch' | 'fresh' | 'manual'
  # itemId dérivé du nom normalisé + dimension d'unité (domain/grocery.ts)
  # préfixé `manual--` pour un article ajouté à la main

households/{hid}/usage/{yyyy-mm-dd}        # rate limiting
  generations: number

households/{hid}/locks/{weekId}            # une génération à la fois par semaine
  startedAt: number                        # ms epoch ; repris au-delà du TTL
  by: string                               # uid

households/{hid}/batchSessions/{weekId}   # session de cuisson du dimanche
  sourceRecipeIds: string[]              # batch à partir duquel elle a été composée
  cuts: { recipeId, ingredient, cut }[]  # « oignon » → « émincé », plat par plat
  steps: { recipeId, text }[]            # cuisson et mélange, dans l'ordre du plat
  timings: { recipeId, cookMinutes }[]   # cuisson seule, concordant avec les étapes
  generatedAt, generatedBy, model, promptVersion

households/{hid}/lexicon/overrides        # rayons attribués par le foyer
  entries: { [aisleOverrideKey(nom)]: Aisle }
```

Un repas porte l'un de cinq `kind` : `batch-leftover` (portion du batch de la
semaine), `cooked` (cuisiné le samedi ou le dimanche), `freezer-backup` (reste du
batch de la semaine précédente, n'achète rien), `eat-out`, et `undecided` — le
samedi et le dimanche tels que la génération les laisse, et les jours d'un plat
retiré du batch. Une recette porte
`prepMinutes` (présence en cuisine) **et** `cookMinutes` (cuisson sans
surveillance) : le budget du dimanche ne compte que le premier.

**Security Rules** — l'intention à implémenter :

- Lecture/écriture sous `households/{hid}/**` uniquement si
  `request.auth.uid in get(/households/$(hid)).data.members`.
- `weeklyPlans` et `recipes` : **lecture seule** pour le client. Seules les functions
  (admin SDK) écrivent. Le client ne fabrique pas de plan.
- `groceryLists/{weekId}/items/{itemId}` : le client ne peut modifier que `checked`,
  garanti par `diff().affectedKeys().hasOnly(['checked'])`. C'est la raison d'être
  de la sous-collection : sur un tableau d'items, cocher une case imposerait de
  réécrire tout le document et la règle ne garantirait plus rien. Bénéfice
  secondaire, deux personnes cochent en même temps sans s'écraser. Le client peut aussi
  **créer et supprimer un article ajouté à la main**, et seulement celui-là :
  identifiant sous `manual--`, `origin == 'manual'`, champs bornés. La borne est
  l'espace de noms — elle empêche de fabriquer un faux article du batch comme de
  supprimer un article calculé. Les rayons et unités y sont recopiés du schéma,
  et un test compare les deux listes.
- `recipes` : même mécanisme, limité à `isFavorite` et `isDisliked`. Les deux
  partent ensemble parce qu'ils s'excluent — mettre en favori lève le
  bannissement — et la règle ne peut borner que les champs, jamais leur
  cohérence : celle-ci s'écrit une seule fois, dans `use-recipe-verdict.ts`.
- `lexicon/overrides` : un membre écrit le seul champ `entries`, dont les valeurs
  sont restreintes aux rayons connus. L'app l'écrit en fusion, pour que deux
  téléphones qui corrigent en même temps ne s'écrasent pas.
- `households` : `members` est immuable côté client — on ne s'ajoute pas à un
  foyer, et on n'en exclut pas l'autre personne. Seule `joinHousehold` y touche.
- `usage` et `locks` : lecture seule côté client. Voir un verrou permet
  d'afficher « génération en cours » ; pouvoir en poser un permettrait de
  bloquer l'autre téléphone indéfiniment.
- `batchSessions` : lecture seule côté client. La session est composée par
  Gemini dans une callable ; pouvoir l'écrire permettrait de réécrire le
  dimanche de l'autre téléphone. Les anciens documents `batchSchedules`,
  d'une autre forme, ne sont plus lus ni autorisés.

Les règles sont testées avec l'émulateur (`npm run test:rules`, dans
`packages/rules-tests`). Une règle non testée est une règle fausse. Ajouter une
règle sans ajouter son test n'est pas une modification terminée.

---

## 6. Cloud Functions

Une responsabilité par function, nommage `verbeNom`.

| Function                | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateWeeklyPlan`    | Compose le batch d'une semaine **qui n'a pas commencé** — la semaine prochaine, et elle seule (`isComposableWeek`, date du jour prise à Paris). Reçoit le nombre de plats et de plats végétariens, construit le prompt avec l'historique des 3 dernières semaines, appelle Gemini, valide via Zod, écrit `weeklyPlans` + `recipes` + `groceryLists` dans un batch, incrémente `usage`.                                                      |
| `setMeal`               | Pose un repas choisi par l'utilisateur : une portion d'un plat du batch, un repas à l'extérieur, ou un reste du batch de la **semaine précédente** — vérifié contre son `batchRecipeIds`. **Aucun appel Gemini, donc aucun quota décompté** — mais le verrou de semaine est pris, car la liste de courses est intégralement recalculée. Vider le dernier repas d'un plat du batch retire le plat ; refusé une fois le batch cuisiné.        |
| `swapMeals`             | Échange deux repas du batch. L'app dit quel plat elle veut sur un créneau ; `findSwapCounterpart` choisit le créneau qui cède sa place — le plus éloigné dans la semaine, sans jamais envoyer en fin de semaine un plat qui ne se congèle pas. Chaque plat sert le même nombre de repas : la liste de courses ne change pas. Ni Gemini ni quota.                                                                                            |
| `regenerateMeal`        | Compose une recette pour un repas du **samedi ou du dimanche** seulement — on ne cuisine plus en semaine. Style `one-pot` (une casserole, 45 min) ou `elaborate`. Passe par le même écrivain que la génération complète : la liste de courses est intégralement recalculée, jamais rapiécée.                                                                                                                                                |
| `replaceBatchRecipe`    | Remplace un plat du batch, et avec lui **tous les repas qu'il servait**. Callable à part et non un paramètre de `regenerateMeal` : un plat du batch n'occupe pas un créneau mais plusieurs, et le remplacer repas par repas coûterait autant de générations qu'il sert de repas, en laissant la semaine incohérente entre deux appels. Avec `removeBatchRecipe` et `setMeal`, seuls écrivains à muter `batchRecipeIds` sur un plan existant |
| `removeBatchRecipe`     | Retire un plat du batch **sans le remplacer** — le frigo est déjà plein. Ses repas passent à décider, ses ingrédients quittent la liste. Ni Gemini ni quota, verrou pris. Refusée une fois le dimanche du batch passé (`isBatchDayPast`) : le plat est au frigo                                                                                                                                                                             |
| `composeCookingSession` | Compose la session de cuisson du dimanche — la découpe de chaque ingrédient et les étapes de cuisson de chaque plat —, **à la demande puis conservée** : une génération par batch, jamais une par consultation. Si une session à jour existe, elle est rendue sans rien décompter — vérification faite sous le verrou, sans quoi deux téléphones ouvrant l'onglet ensemble paieraient deux fois                                             |
| `joinHousehold`         | Consomme un code d'invitation et ajoute l'uid aux `members`. Côté serveur pour que le code reste à usage unique.                                                                                                                                                                                                                                                                                                                            |

Contrat Gemini :

- Réponse en **JSON structuré** (`responseMimeType: application/json` + `responseSchema`),
  pas de parsing de markdown.
- Validation Zod après réception. En cas d'échec : **un seul** retry, puis erreur
  `HttpsError('internal')` avec un message lisible côté app. Jamais de boucle.
- Le prompt vit dans `functions/src/gemini/prompt.ts`, en une seule constante versionnée,
  jamais construit par concaténation dispersée dans le code.

**Deux reprises de nature différente, à ne pas confondre :**

| Reprise   | Quand                                                     | Combien                                    |
| --------- | --------------------------------------------------------- | ------------------------------------------ |
| Contenu   | Le modèle a répondu, mais hors schéma ou hors contraintes | **1 seule**, en réinjectant les violations |
| Transport | 429/500/502/503/504 — le modèle n'a rien produit          | 3 essais, attente 1 s puis 3 s             |

La seconde n'est pas la boucle que le projet s'interdit : rien n'a été généré,
donc rien n'a été consommé côté modèle. Elle est portée par `gemini/client.ts`,
et sa classification vit dans `gemini/transport-errors.ts` — isolée pour être
testable sans réseau, car elle repose sur la forme des erreurs d'un SDK tiers,
qui n'expose pas son statut HTTP de façon stable.

La reprise de contenu vit en un seul endroit, `gemini/content-retry.ts`. Les
quatre chaînes — semaine, repas, plat du batch, session de cuisson — ne diffèrent que par
leur schéma et leur validateur, et en portaient chacune une copie de quarante
lignes : une politique de reprise écrite quatre fois finit par en être quatre.
Même chose pour ce que les callables partagent — lire le plan ou dire qu'il
manque, rendre la génération sur saturation — dans `lib/callable-support.ts`.

Quand les trois essais échouent, la callable **rend au foyer la génération
décomptée** (`refundGenerationQuota`) : le quota protège la clé Gemini, pas le
budget de l'utilisateur, et une saturation chez Google ne doit rien lui coûter.
Un plan refusé aux contraintes, lui, n'est pas remboursé — les appels ont bien
eu lieu.

Les messages d'erreur remontés à l'app disent ce qui s'est passé **et** ce que
l'utilisateur peut faire. Un message qui dit seulement « erreur interne » oblige
à ouvrir les logs pour répondre à quelqu'un qui est devant son téléphone.

**Ce que la génération produit, et ce qu'elle ne produit plus.** Le modèle ne
décrit que le batch et les jours du lundi au vendredi (`dayIndex` 2 à 6, tous
`batch-leftover`) ; `toWeeklyPlan` pose le samedi et le dimanche en `undecided`.
Ce qu'il ne peut pas décrire, il ne peut pas le rater — et on n'achète plus un
repas que le foyer prendra peut-être dehors. `validateGeneratedPlan` exige
(prompt version 8) :

- exactement le nombre de plats demandé, et rien d'autre dans `recipes` ;
- **la répartition annoncée** : `distributeMeals` répartit les dix repas au plus
  égal — 4/3/3 pour trois plats, donc 8/6/6 portions — et chaque plat déclare
  **exactement** deux portions par repas servi. Le modèle ne calcule plus rien :
  diviser 20 portions par 3 donnait des plats à 7 portions, donc des
  demi-assiettes ;
- `congelable` pour un plat servi jeudi ou vendredi ;
- 240 minutes de **présence** au plus, la cuisson sans surveillance exclue ;
- un plat `mijote` ou `four-lent` pour 3 ou 4 plats, un de chaque dès 5, avec au
  moins 60 minutes de cuisson — le plat qui cuit seul pendant qu'on prépare les
  autres ;
- exactement le nombre de plats `vegetarien` choisi, et aucun d'eux avec un
  ingrédient des rayons boucherie ou poissonnerie ;
- aucun plat banni.

Le prompt reçoit en outre les fruits et légumes du mois visé
(`domain/seasonality.ts`, région Centre-Val de Loire). C'est une consigne, pas un
filet : un validateur de saison ferait refuser des plans légitimes.

**On ne compose jamais une semaine entamée.** Elle a commencé samedi : un plan
composé maintenant arriverait après les courses et le batch qu'il devait
organiser. Le samedi et le dimanche, la semaine suivante reste composable — elle
commence dans six ou sept jours. Pas plus loin : composer deux semaines d'avance,
c'est choisir des plats avant de savoir ce qui reste du batch précédent. La
règle vit dans `getComposableWeekId`, lue
par l'accueil comme par la callable ; celle-ci prend la date du jour à Paris
(`lib/clock.ts`), les functions tournant en UTC.

**Un plat du batch ne se vide pas en silence.** Un plat que plus aucun repas
ne sert serait cuisiné sans être mangé. Cuisiner moins — le frigo est déjà
plein — passe donc par un geste qui **retire le plat du batch**
(`removeBatchRecipeFromPlan`) : explicitement, avec `removeBatchRecipe`, dont
les repas passent à décider ; ou en vidant son dernier repas
(`isLastMealOfBatchDish`) par un reste ou un repas dehors, auquel cas
`setPlanMeal` retire le plat derrière. Y servir un autre plat du batch reste
refusé — l'échange fait la même chose sans perdre de plat —, et tout retrait
l'est une fois le dimanche du batch passé : le plat est au frigo. Un créneau à
décider en semaine peut reprendre une portion du batch tant qu'il n'est pas
cuisiné, et l'accueil compte les repas à décider sur toute la semaine
(`countUndecidedMeals`) : ce qu'on y posera s'achète le samedi.

**Un temps de cuisson, une seule vérité.** `cookMinutes` et le texte des étapes
sont produits séparément, et une fiche a annoncé 60 minutes de cuisson en
disant « mijoter 1 h 30 ». `cookTimeViolations` lit les durées écrites dans les
étapes (`parseDurations`) et refuse la plus longue — au-delà de 20 minutes, en
deçà c'est un geste surveillé — si elle dépasse le temps déclaré de plus de
10 %. La règle joue à la génération de la semaine, au remplacement d'un plat
et à la recette du week-end ; la session de cuisson rend en plus son propre
temps par plat (`timings`), seul lu par l'écran du dimanche
(`orderCookingSession`, `sessionCookMinutes`), avec la recette pour repli.

**Ce qui est acheté est ce qui est cuisiné.** `batchRecipeIds` liste les plats
cuisinés le dimanche. `buildGroceryList` les compte **une fois chacun, au
prorata des repas qu'ils servent réellement** — `getBatchPortions`, qui rend
deux portions par repas `batch-leftover`, avec un plancher d'un repas. L'écran
du dimanche lit la même fonction : l'égalité est vraie par construction. Les
quantités de la recette sont mises à l'échelle depuis `servings`, additionnées
en flottant, puis arrondies **une seule fois, vers le haut** (`roundUpQuantity`) :
arrondir par recette empilerait les erreurs, et arrondir vers le bas ferait
manquer en cuisinant. Le document recette n'est jamais réécrit — il est partagé
entre les semaines. Un repas dehors, un reste d'une semaine précédente
(`freezer-backup`) et un créneau à décider n'achètent rien. Les repas cuisinés
le samedi et le dimanche s'ajoutent pour deux portions par repas, en origine
`fresh`.

**Le recalcul est intégral, les ajouts à la main survivent.** `commitPlan`
supprime tout article absent de la liste recalculée ; `mergeGroceryLists` y
reporte donc les cases cochées **et** les articles `manual`, qu'aucune recette
ne reproduit. Un repas `cooked` citant un plat du batch est ignoré : la contrainte
de génération l'interdit, mais un plan édité repas par repas peut produire ce
cas, et il ne doit pas coûter le double.

**Le rappel tombe le soir où il sert.** `getThawReminders` ne regarde que les
plats servis **demain**, et seulement si demain impose la congélation : un plat
servi mercredi sortait du frigo, même s'il porte l'étiquette parce qu'il est
aussi servi vendredi. L'écran de préparation, lui, dit de congeler en portions —
c'est une consigne de cuisine, pas un rappel.

**Remplacer un plat du batch, et l'ordre qui compte.**
`replaceBatchRecipeInPlan` réécrit `batchRecipeIds` **avant** de recalculer
`recipeIds`, et ce n'est pas un détail de style : `recipeIds` réunit les plats du
batch, donc laisser l'ancien slug dedans le maintiendrait dans la liste, et
`buildGroceryList` continuerait d'acheter ses ingrédients pour un plat que plus
personne ne cuisine. La position dans `batchRecipeIds` est conservée — c'est elle
qui donne son ordre à la session du dimanche.

`validateBatchRecipeReplacement` rejoue les trois contraintes que
`validateMealReplacement` exclut à dessein : portions pour tous les repas
servis, congélation si le plat tombe en fin de semaine, et temps restant dans
l'après-midi une fois les autres plats comptés. Elles sont nécessaires parce que
`buildGroceryList` n'achète un plat du batch **qu'une fois, aux portions
déclarées** : un remplaçant qui en produit trop peu et le foyer sous-achète, sans
un mot.

**Le dimanche en deux temps : mise en place, puis cuisson.** Le premier
déroulé fondait les étapes de tous les plats en une séquence rédigée par
Gemini ; à l'usage, illisible les mains prises. La vue « Mise en place puis
cuisson » suit une vraie session de batch :

1. **La mise en place se calcule** (`getMiseEnPlace`) : tout ce qui se coupe,
   groupé dans l'ordre de la planche — aromates (oignons, ail, herbes à
   ciseler), légumes, viande, poisson —, qui est aussi l'ordre d'hygiène. Les
   herbes en branche (thym, romarin, laurier…) n'y figurent pas. Une ligne par plat, avec la
   quantité des portions réellement cuisinées (`scaleIngredients`). Ce qui ne se
   coupe pas sort par son **rayon** : épicerie, crèmerie et les autres ne
   figurent pas, ce qui écarte l'huile, le beurre et les épices sans liste à
   tenir. Une ligne par ingrédient, reconnu à son nom au singulier : « oignons »
   et « oignon », 300 g de carotte et deux carottes font une ligne, chaque part
   gardant son unité — rien ne s'additionne entre plats, contrairement aux
   courses. Elle s'affiche avant toute génération.
2. **La cuisson se génère, une fois** : Gemini rend, pour chaque plat, la
   découpe de chaque ingrédient à couper et les étapes restantes, sans découpe
   ni quantité. Sans la découpe, l'information « émincé » ou « en dés »
   disparaîtrait avec les étapes qui la portaient. Les fiches suivent
   `orderForCooking` — du temps de cuisson le plus long au plus court — et un
   plat qui cuit seul invite à passer au suivant.

`validateCookingSession` refuse un plat sans étape, une étape qui **commence**
par un geste de découpe (« Ajouter les oignons émincés » passe), et une découpe
d'un ingrédient que la recette ne contient pas, et un temps de cuisson que les
étapes démentent. Le modèle n'ordonne rien et ne
compte rien : l'ordre et les quantités se calculent, là où il pourrait se
tromper.

Une session composée puis un plat remplacé : elle décrit un batch qui n'existe
plus. Plutôt que de compter sur chaque écrivain pour l'effacer, le document
fige `sourceRecipeIds`, et `isCookingSessionCurrent` le compare au plan au moment de
l'afficher. La mise en place, calculée, est toujours à jour ; seules les
découpes et les étapes demandent d'être recomposées. « Recette par recette »
reste la vue par défaut.

**Une règle, un seul endroit.** `requiresFreezing(dayIndex)` dit qu'un plat servi
jeudi ou vendredi doit se congeler — cuisiné le dimanche, il aurait attendu cinq
ou six jours au frigo. Elle gouverne deux choses à la fois : la contrainte qui
refuse un plan, et la mention « à congeler » de l'écran du batch. Elle vit dans
`domain/week.ts`, et nulle part ailleurs — elle était écrite deux fois avant.

Corollaire non évident, protégé par un test : **un plat du batch ne quitte
jamais `recipeIds` tant qu'il est au batch**, même si plus aucun repas ne le
sert — seul son retrait de `batchRecipeIds` l'en fait sortir. Il est cuisiné donc
acheté ; l'en retirer ferait disparaître ses ingrédients de la liste sans le
moindre message, et le foyer sous-achèterait.

**Progression d'une génération.** Une callable est un aller-retour HTTP : elle
n'émet rien avant sa réponse, et l'attente dure environ une minute — dont 96 %
passés à attendre le modèle. La function publie donc son étape dans le document
de verrou (`locks/{weekId}`), que l'app écoute. Le verrou et la progression sont
le même document parce qu'ils décrivent le même fait : une génération en cours.

**Ce document ne doit jamais contenir autre chose qu'un code d'étape énuméré.**
Il est lisible par les membres du foyer ; y déposer un message d'erreur brut ou
un extrait de la réponse du modèle ferait fuir de l'information technique par un
canal qui n'est pas fait pour ça. `GenerationStep` est une énumération fermée, et
les libellés en français vivent dans l'app. Un test vérifie que les seules clés
écrites sont celles du schéma.

**Une génération à la fois par semaine.** `acquireGenerationLock` est posé
avant la consommation du quota, à dessein : sans lui, deux téléphones qui
appuient en même temps passent tous deux la vérification d'existence du plan,
consomment chacun une génération, et le dernier écrit écrase l'autre. Le foyer
paierait deux fois pour un seul résultat. Un verrou plus vieux que
`GENERATION_LOCK_TTL_MS` est repris — une function tuée par son timeout n'a pas
pu libérer le sien, et le foyer ne doit pas rester bloqué pour autant.

**Mémoire du foyer.** Le prompt reçoit trois listes, composées ensemble dans
`functions/src/lib/recipe-memory.ts` :

| Liste                             | Sens                                            | Portée                                     |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| Recettes des 3 dernières semaines | à ne pas reproposer                             | s'oublie au bout de 3 semaines             |
| Favoris                           | le modèle peut en reprendre **un seul** au plus | tant que le cœur est coché                 |
| Plats bannis (`isDisliked`)       | interdits, sans réserve                         | définitif, jusqu'à levée dans les réglages |

Les composer au même endroit est la seule façon de garantir qu'elles ne se
contredisent pas : un favori servi récemment est retiré de la deuxième liste, et
un plat à la fois favori et banni en est retiré aussi — le rejet l'emporte. Sans
cela on demanderait au modèle une chose et son contraire. C'est ce qui donne un
effet aux boutons favori et « je n'aime pas » ; sans cela ils ne serviraient
qu'à faire des listes.

**Le bannissement porte sur le nom, pas sur l'identifiant.** `recipeId` est le
slug produit par Gemini, et rien ne l'oblige à réémettre le même slug pour le
même plat : bannir un id se contournerait tout seul. Le nom part donc dans le
prompt comme interdiction, et `validateGeneratedPlan` double la consigne d'un
filet — un modèle ignore parfois une contrainte négative, et servir à
l'utilisateur le plat qu'il vient de rejeter tuerait la fonctionnalité au
premier ratage. La comparaison du filet est une **égalité normalisée**
(`normalizeName`), jamais un rapprochement flou : un validateur approximatif
refuserait des recettes légitimes, et chaque refus coûte une reprise.

---

## 7. Conventions de code

- **TypeScript strict** (`strict: true`, `noUncheckedIndexedAccess: true`). `any` interdit ;
  utiliser `unknown` + validation.
- Types dérivés des schémas Zod (`z.infer`), jamais déclarés en double.
- Composants fonctionnels, un composant par fichier, nommage `PascalCase.tsx`.
- Les hooks de données vivent dans `features/<x>/api/`, préfixés `use` — un composant
  ne consomme jamais le SDK Firestore en direct.
- **Huit écritures Firestore partent du client, et huit seulement.** Toute
  autre passe par une Cloud Function ; en ajouter une neuvième demande d'abord
  sa règle et son test.

  | Écriture                           | Pourquoi elle est sûre                                                                                                       |
  | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | `useToggleGroceryItem` → `checked` | La règle borne l'écriture à ce seul champ. Passer par une callable n'ajouterait qu'une latence au milieu d'un magasin        |
  | `useToggleFavorite` → `isFavorite` | Même mécanisme, même raison : le geste doit répondre à l'instant                                                             |
  | `useToggleDislike` → `isDisliked`  | Même règle, même fichier : les deux verdicts s'excluent et s'écrivent ensemble                                               |
  | `createHousehold`                  | La règle exige `members == [uid]` et `createdBy == uid` : on ne peut créer qu'un foyer dont on est le seul membre            |
  | `refreshInviteCode`                | `onlyChanges(['name', 'inviteCode'])` : `members` reste inaccessible au client                                               |
  | `useAddGroceryItem`                | Identifiant sous `manual--`, `origin == 'manual'`, champs et valeurs bornés : on ajoute du sac poubelle debout dans un rayon |
  | `useDeleteGroceryItem`             | Seul un article `manual` est supprimable : un article calculé reviendrait au recalcul, et le retirer ferait sous-acheter     |
  | `useSaveAisleCorrection`           | Un seul document, le seul champ `entries`, des rayons connus ; écrit en fusion pour que deux téléphones ne s'écrasent pas    |

- Pas d'état optimiste écrit à la main sur une donnée Firestore : le SDK
  applique l'écriture localement avant de la confirmer, et le listener la
  reflète aussitôt. Une case bascule immédiatement, même hors réseau.
- Pas de valeurs magiques dans le style : tout passe par `theme/`. L'app supporte le
  mode sombre dès la v1 — définir chaque couleur dans les deux thèmes, jamais en dur.
  Le thème suit le téléphone par défaut, et se force en clair ou en sombre depuis
  les réglages. Trois états et non deux : « système » est un choix, pas une
  absence de choix. La préférence est locale au téléphone — les deux personnes
  n'ont pas à voir la même chose — et l'app la pousse aussi à
  `Appearance.setColorScheme`, faute de quoi le clavier et les éléments système
  continueraient de suivre le téléphone.
- Textes d'interface en français, code et identifiants en anglais. Apostrophe
  typographique (’) dans le texte affiché, jamais l'apostrophe droite.
- **Auth : importer depuis `@firebase/auth`, pas `firebase/auth`.** Le package
  meta ne publie que la variante navigateur, dépourvue de
  `getReactNativePersistence` — sans elle, la session est perdue à chaque
  redémarrage de l'app. Un `paths` dans `app/tsconfig.json` réaligne le typage
  sur ce que Metro résout réellement.
- Pas de `setState` synchrone dans un `useEffect` : dériver l'état au rendu
  (voir `useHousehold`). La règle est appliquée par le lint. Une hydratation
  depuis le disque est asynchrone par nature et fait exception — elle s'écrit
  alors dans l'état, et la course avec le premier snapshot serveur se tranche
  par un drapeau, jamais en espérant un ordre d'arrivée.
- **L'écran de préparation garde le téléphone allumé** (`useKeepAwake`), et
  seulement lui. Trois heures de cuisine les mains prises ne se font pas en
  rallumant l'écran toutes les trente secondes.
- **L'avancement du batch est local au téléphone.** Les étapes n'ont aucune
  identité stable — ni identifiant, ni durée : leur seule adresse est l'index
  dans la recette. `stepCount` est donc stocké avec les cases cochées, et une
  entrée dont le compte ne correspond plus est ignorée : un plat remplacé
  repart de zéro plutôt que d'afficher des cases fausses au milieu d'une
  session de cuisine.
- **Tout abonnement Firestore passe par `subscribeWithRetry`.** Firestore
  **arrête définitivement** un listener qui échoue : après une erreur il ne
  reçoit plus rien, même si la cause a disparu. Le cas qui l'impose : à la
  création du foyer, les écrans montent leurs listeners avant que la règle
  `isMember` — qui fait un `get()` sur le document du foyer — ne voie ce
  document. Elle refuse, et sans reprise le planning, la progression de
  génération et les courses restent morts jusqu'au prochain montage, alors que
  tout est en ordre une seconde plus tard. Un `onSnapshot` posé en direct est
  donc une erreur ; il y en a huit, tous enveloppés.
- **Ce qui vient du cache local n'est jamais persisté.** `metadata.fromCache`
  distingue un snapshot confirmé par le serveur d'un snapshot qui reflète nos
  propres écritures en attente. Persister le second figerait une vue partielle
  du foyer.
- Erreurs : jamais de `catch` silencieux. Soit on remonte à l'utilisateur, soit on log
  avec du contexte. **Écarter en silence un document qui ne passe pas son schéma
  est un `catch` silencieux déguisé** : une liste illisible devient alors
  indiscernable d'une liste vide, et le diagnostic impossible depuis le
  téléphone. Compter les rejets et le dire.
- Les documents écrits par les functions sont typés par le schéma qui les
  décrit (`Omit<WeeklyPlan, 'id'>`). Ajouter un champ au schéma sans l'écrire
  devient une erreur de compilation, plutôt qu'un document incomplet découvert
  à la lecture.
- Aucun `as` sur une donnée externe, et aucun dans le projet aujourd'hui.
- Commits conventionnels (`feat:`, `fix:`, `chore:`).
- **L'affichage doit tenir sur tous les Android, sans changer là où il tenait
  déjà.** Trois réglages du téléphone l'ont pris en défaut, sur un Samsung à
  police par défaut et navigation à trois boutons :
  - la **taille de police** : un libellé de `SegmentedSwitch` tient sur une
    ligne et se réduit s'il manque de place (`adjustsFontSizeToFit`), plutôt que
    de passer à la ligne et de désaligner les onglets ;
  - la **barre de navigation** : Android dessine l'app dessous. `Screen` ajoute
    en bas la hauteur de cette barre, sauf sur les écrans d'onglets
    (`withTabBar`), où la barre d'onglets la couvre déjà ;
  - le **clavier** : en plein écran, la fenêtre ne se réduit plus quand il
    s'ouvre. `Screen` enveloppe le contenu d'un `KeyboardAvoidingView`, sans quoi
    le champ du mot de passe restait caché et impossible à atteindre.

### Où va quel test

Quatre suites, séparées par ce dont elles ont besoin pour tourner, pas par le
dossier où vit le code.

| Suite                    | Couvre                                                                                                     | Coût                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `npm run test`           | `packages/shared` : domaine pur, schémas Zod, chemins Firestore                                            | aucune dépendance, moins d'une seconde |
| `npm run test:app`       | `app/src` : reprise des abonnements Firestore, stockage local, contrat des callables                       | aucune dépendance                      |
| `npm run test:functions` | `functions/src` : guards, quota, écriture du plan, politique de reprise, classification des erreurs Gemini | démarre l'émulateur Firestore          |
| `npm run test:rules`     | `firestore.rules` face à un client non privilégié                                                          | démarre l'émulateur Firestore          |

### Le lint

`oxlint` (config `.oxlintrc.json` à la racine) a remplacé ESLint. Trois raisons,
dans cet ordre d'importance :

1. **Il couvre les quatre workspaces.** ESLint ne lisait que `app/` — c'était une
   limite documentée ici même. Dès la première exécution, oxlint a trouvé trois
   imports morts dans `functions/` et `packages/rules-tests/` qu'aucun audit
   n'avait vus.
2. **Il garde ce qui compte.** Les règles React Compiler sont natives, dont
   `set-state-in-effect` — celle sur laquelle s'appuie la convention du §7 — et
   `no-deriving-state-in-effects`, qui énonce littéralement la règle « dériver
   l'état au rendu ». Vérifié en écrivant les fautes exprès.
3. **Il ne dépend pas du compilateur TypeScript**, là où `@typescript-eslint`
   plafonnait le projet sous TypeScript 6. C'est ce qui a débloqué TS 7.

0,36 s sur tout le dépôt, contre 1,39 s pour ESLint sur `app/` seul.

Ce qu'on a perdu est en §9 : les trois règles d'`eslint-plugin-expo`.

### Le code mort

`knip` cherche ce que ni le typage ni le lint ne voient : un fichier que plus
rien n'atteint, un export que personne n'importe, une dépendance déclarée et
jamais utilisée. C'est ce qu'on cherchait à la main à chaque audit, et la
première exécution a trouvé **sept dépendances mortes** — dont six paquets
`expo-*` qu'EAS compilait dans l'APK pour rien.

Deux réglages méritent leur explication, dans `knip.json` :
`scripts/probe-gemini.ts` est déclaré point d'entrée parce qu'aucun import n'y
mène — c'est esbuild qui le construit ; et la règle `duplicates` est désactivée
parce que `WeekIdSchema = IsoDateSchema` est un alias voulu, décrit au §5.

La CI le fait échouer. Une dépendance inutilisée compile parfaitement et se
déploie sans un mot : c'est le genre de chose qu'il faut une machine pour voir.

### Le format

`oxfmt`, réglé sur `singleQuote` et `printWidth: 100` — les deux valeurs qui
collent à ce que le code était déjà. Mesuré avant de basculer : à 110 le diff
grossit, parce que le formateur recolle alors des lignes coupées à dessein.

Il est **encore en 0.x**, et c'est un choix assumé (§9). `format:check` tourne en
CI pour que ce pari reste tenable.

### La CI

`.github/workflows/ci.yml` lance sur chaque push et chaque PR ce que `test:all`
lance en local, sur une machine qui n'a rien d'installé : Node lu dans `.nvmrc`
(**24**, celui du runtime déployé — l'`engines` racine et `firebase.json`
disaient deux choses différentes), Java 21 pour l'émulateur, puis typage, lint et
les quatre suites.

Elle **alerte sans bloquer** : `main` n'est pas protégée, on y pousse
directement, et une CI rouge se voit. La protéger reste une case à cocher.

Elle ne porte **aucun secret**, et ne doit jamais en porter : le dépôt est
public. Le déploiement et `gemini:probe` restent des gestes manuels — mettre une
clé de service account dans les secrets d'un dépôt public créerait une surface
d'attaque permanente pour économiser une commande tapée une fois par semaine.

Un pas mérite son explication : **la CI démarre `expo start` le temps qu'il
écrive `app/.expo/types/router.d.ts`**. Ce fichier est généré et gitignoré, donc
absent d'un clone frais, et c'est lui qui restreint le type `Href` aux routes
réelles. Sans lui, `router.push('/route-inexistante')` compile sans broncher —
vérifié — et la CI serait moins stricte que la machine locale. Aucune
sous-commande de génération n'existe dans le CLI d'Expo SDK 57 ; seul `start`
produit ce fichier.

Le lint couvre les quatre workspaces depuis le passage à oxlint — voir plus
haut. C'était une limite de l'ancienne configuration, pas un choix.

`npm run test:coverage` mesure le domaine partagé, hors `index.ts` — un baril
de ré-exports n'a rien à couvrir, et l'y inclure rendait le total illisible. Le
seuil implicite est simple : **les schémas restent à 100 %**. Ce sont eux qui gardent les
frontières, et un schéma trop permissif ne se voit nulle part — il laisse
passer, et la donnée fausse ressort trois écrans plus loin.

Ce qui appartient au domaine pur se teste dans `shared`, jamais à travers une
function : c'est plus rapide et le diagnostic est direct. Ce qui se teste dans
`functions` est ce que Zod ne peut pas garantir — l'atomicité d'un batch, la
justesse d'une transaction sous contention, ce qu'une réécriture doit épargner.

La suite `app` ne couvre que ce qui ne rend rien. Monter un composant
demanderait un renderer React, un environnement DOM et une transformation des
modules React Native — écrits en Flow — dont le dépôt n'a rien aujourd'hui ;
s'y ajouterait un écart réel, `reactCompiler` étant actif en production et pas
sous test. C'est un chantier en soi, listé au §9. **Ce qui est couvert l'est
vraiment ; le reste ne l'est pas, et le document le dit** plutôt que de laisser
croire à une couche testée.

Les tests des functions parlent à l'admin SDK, qui ignore les Security Rules :
ils ne prouvent jamais qu'un accès est refusé au client. C'est le rôle exclusif
de `test:rules`, et la raison pour laquelle les deux suites existent.

`src/__tests__/emulator.ts` refuse de démarrer si `FIRESTORE_EMULATOR_HOST` est
absent. C'est délibéré : sans cette garde, une suite lancée à la main écrirait
dans le vrai Firestore avec les droits de l'admin SDK.

---

## 8. Commandes

Tous depuis la racine du dépôt.

```bash
npm install                      # installe tous les workspaces
npm run build:shared             # requis avant tout déploiement de functions
npm run dev                      # Expo dev server
npm run emulators                # Firestore + Auth + Functions en local
npm run test                     # Vitest sur le domaine partagé, sans émulateur
npm run test:app                 # logique de l'app, sans rendu ni émulateur
npm run test:functions           # Guards et écritures Firestore, sur émulateur
npm run test:rules               # Security Rules sur émulateur
npm run test:all                 # les quatre, dans cet ordre
GEMINI_API_KEY=… npm run gemini:probe   # chaînes de génération, sans déployer
#   -- plan | meal | batch | session pour n'en tester qu'une
npm run typecheck                # tsc --noEmit sur tous les workspaces
npm run lint                     # oxlint, les quatre workspaces
npm run knip                     # code mort : fichiers, exports, dépendances
npm run format                   # oxfmt sur tout le dépôt
npm run format:check             # échoue si un fichier n'est pas formaté
npm run test:coverage           # couverture du domaine partagé
npm run deploy:dev               # règles, index et functions sur dimanche-batch-dev
npm run deploy:prod              # la même chose sur dimanche-batch, la prod
npm run build:android            # EAS, profil preview : APK de test, base de dev
npm run build:android:prod       # EAS, profil production : l'APK du foyer
```

`gemini:probe` envoie à Gemini les payloads réels des quatre callables qui
l'appellent, puis fait traverser chaque réponse les deux mêmes filtres que la
function correspondante (`-- plan`, `-- meal`, `-- batch` ou `-- session` pour
n'en tester qu'une). **À lancer avant tout changement de modèle ou de
`responseSchema`** : l'API refuse certaines
constructions de schéma avec un `INVALID_ARGUMENT` qui ne nomme aucun champ, et
publie des modèles fermés aux comptes récents qui répondent 404 alors qu'ils
figurent dans `GET /models`. Dans les deux cas, seul un appel réel tranche, et
diagnostiquer depuis une function déployée coûte un cycle de déploiement plus
l'attente d'ingestion des logs.

**Deux projets Firebase, et la prod n'est jamais la cible par défaut.**

| Projet               | Rôle                           | Qui s'en sert                                                  |
| -------------------- | ------------------------------ | -------------------------------------------------------------- |
| `dimanche-batch-dev` | base de test, données jetables | `npm run dev`, builds EAS `development` et `preview`, `-P dev` |
| `dimanche-batch`     | les vraies données du foyer    | build EAS `production`, `-P prod`                              |

Tester contre la prod, c'est risquer d'effacer la semaine du foyer en essayant
une régénération. D'où trois garde-fous :

- `.firebaserc` fait de `dev` le projet **par défaut** : une commande `firebase`
  lancée sans `-P` touche la base de test. Les scripts de déploiement nomment
  toujours leur cible — `deploy:dev`, `deploy:prod` — et il n'existe plus de
  script de déploiement sans cible.
- `app/.env.development` porte la configuration du projet de dev. Expo le
  charge en développement et le fait passer devant `app/.env`, qui pointe sur
  la prod : `npm run dev` écrit en test sans qu'on ait rien à changer. Tant
  qu'il est vide, l'app refuse de démarrer plutôt que de retomber sur la prod.
- Un bandeau « BASE DE TEST » s'affiche en haut de chaque écran dès que l'app
  ne parle pas à la prod (`isProduction`, `lib/env.ts`).

Le projet de dev porte les mêmes règles, les mêmes functions et son propre
secret `GEMINI_API_KEY` (la même clé convient, elle vit sur le projet Google
Cloud sans facturation). Les émulateurs restent utilisables
(`EXPO_PUBLIC_USE_EMULATORS=1`), mais sous WSL2 avec un téléphone physique ils
demandent de relayer les ports vers Windows ; le projet de dev évite ce
détour.

**Le build EAS ne lit pas `app/.env`.** EAS n'envoie au serveur de build que ce
que git suit, et `.env` est ignoré : sans autre source, l'APK serait compilé
avec une configuration Firebase vide, et l'app ne pourrait pas se connecter.
Les six `EXPO_PUBLIC_FIREBASE_*` vivent donc aussi dans les variables
d'environnement du projet EAS (`@devwanderer/dimanche-batch`), que les profils
de `eas.json` désignent par leur champ `environment` : `development` pour les
profils `development` et `preview` (valeurs du projet de dev), `production`
pour le profil `production` (valeurs de la prod). Elles n'y sont pas au titre de secrets — elles sont lisibles
dans l'APK — mais pour rester hors d'un dépôt public. Si l'une change dans
`.env`, la reporter avec `eas env:update`. `EXPO_PUBLIC_USE_EMULATORS=0` est
fixé par `eas.json` : un APK ne parle jamais aux émulateurs.

---

## 9. Périmètre v1 et points d'extension

Ce qui est **délibérément** simple en v1, et où brancher la suite :

| Raccourci v1                                                                                  | Pourquoi                                                                                                                                                                                                                                                | Extension v2                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Un seul foyer par utilisateur                                                                 | Usage à deux, pas de cas multi-foyer                                                                                                                                                                                                                    | `members` est déjà un tableau ; ajouter un sélecteur de foyer                                                                                                                                                                                                |
| Auth email + mot de passe                                                                     | Zéro dépendance native, build simple                                                                                                                                                                                                                    | Ajouter Google Sign-In (provider Firebase, pas de migration de données)                                                                                                                                                                                      |
| Pas de saisie manuelle de recette                                                             | L'IA couvre le besoin initial                                                                                                                                                                                                                           | Les `recipes` sont déjà une collection à part entière ; il suffit d'un écran d'édition                                                                                                                                                                       |
| Pas de gestion des restes du frigo                                                            | Hors périmètre                                                                                                                                                                                                                                          | Nouveau champ d'entrée du prompt, pas de changement de schéma                                                                                                                                                                                                |
| App Check désactivé                                                                           | L'auth suffit pour deux utilisateurs                                                                                                                                                                                                                    | Activer et exiger le token dans les callables                                                                                                                                                                                                                |
| Foyer de deux personnes en dur (`SERVINGS_PER_MEAL`)                                          | La v1 sert un seul foyer connu                                                                                                                                                                                                                          | Un champ `size` sur `Household`, lu par les contraintes de portions et par le prompt                                                                                                                                                                         |
| La session de cuisson n'est comparée au plan que par ses identifiants                         | Un plat régénéré sous le même slug garde son identifiant : ses étapes peuvent changer sans que la session soit déclarée périmée. Cas rare — `replaceBatchRecipe` produit en pratique un nouveau slug                                                    | Figer une empreinte des étapes dans `sourceRecipeIds`, ou effacer la session depuis chaque écrivain du plan                                                                                                                                                  |
| La session de cuisson n'est pas dans le cache hors ligne                                      | Il se consulte chez soi, le dimanche, réseau disponible ; le cache mémoire de Firestore suffit tant que l'app est ouverte                                                                                                                               | L'ajouter à `offline-cache.ts` comme le plan et les recettes                                                                                                                                                                                                 |
| Les règles propres à Expo ne sont plus appliquées                                             | `eslint-plugin-expo` apportait `no-dynamic-env-var`, `no-env-var-destructuring` et `use-dom-exports`, sans équivalent oxlint. Les deux premières gardaient un seul fichier, `app/src/lib/env.ts`, qui lit ses variables statiquement et ne bouge jamais | Relire `env.ts` à la main si on y touche : Expo **inline** les `EXPO_PUBLIC_*` à la construction, donc un accès destructuré ou dynamique vaudrait `undefined` dans l'APK, en silence                                                                         |
| oxfmt est en 0.x                                                                              | Choisi en connaissance de cause : petit projet, enjeu faible, et l'occasion d'essayer l'outil pendant qu'il se construit. Même famille qu'oxlint                                                                                                        | `npm run format:check` en CI est ce qui rend le pari tenable : si une version change ses règles, la CI le dit d'un coup au lieu de laisser le formatage dériver fichier par fichier. En secours, `oxfmt --migrate` sait convertir depuis une config Prettier |
| Les composants de `app/` ne sont pas testés                                                   | Aucun renderer React ni environnement DOM installé, pas de configuration Babel dans `app/`, et les modules React Native sont en Flow — inconsommables tels quels par Vitest. La logique sans rendu, elle, est couverte                                  | Ajouter un environnement DOM et un renderer, en acceptant que `reactCompiler` ne s'applique pas sous test : ce qu'on mesurerait ne serait pas tout à fait ce qui tourne                                                                                      |
| Renovate ne suit pas les paquets du SDK Expo                                                  | Leur version est dictée par le SDK, pas par le semver npm : une montée faite hors d'`expo install` casse le build de façon pénible à diagnostiquer                                                                                                      | La CI lance `npx expo install --check` à chaque exécution et signale la dérive. Au changement de SDK, `npx expo install --fix` réaligne tout le bloc d'un coup                                                                                               |
| 200 plats bannis lus au plus (`BANNED_READ_LIMIT`)                                            | Un foyer en bannit quelques-uns par an ; la borne protège le coût de lecture avant d'être une limite réelle                                                                                                                                             | Paginer la lecture, ou porter un `dislikedAt` pour ne garder que les plus récents dans le prompt                                                                                                                                                             |
| La règle du plat qui mijote n'est rejouée au remplacement d'un plat que si le batch la tenait | Les plans composés avant elle n'ont aucun plat marqué : l'exiger rendrait ces semaines impossibles à modifier                                                                                                                                           | Retirer la condition quand plus aucun plan antérieur à la version 8 du prompt n'est modifiable                                                                                                                                                               |
| Le compte végétarien n'est pas mémorisé avec le plan                                          | Remplacer un plat du batch est un choix du foyer : lui imposer un compte qu'il a choisi une semaine plus tôt le surprendrait                                                                                                                            | Stocker `vegetarianCount` sur le plan et le passer au remplacement                                                                                                                                                                                           |
| Le rayon d'un article manuel se devine par une table livrée (~740 articles)                   | Zéro coût, hors ligne, testable ; les manques sont corrigés par le foyer et listés dans les réglages                                                                                                                                                    | Reverser le lexique du foyer dans la table à chaque version                                                                                                                                                                                                  |
| Android uniquement                                                                            | Les deux téléphones sont Android                                                                                                                                                                                                                        | Expo est cross-platform : ne jamais écrire de code Android-spécifique sans garde `Platform`                                                                                                                                                                  |

---

## 10. Ce qu'il ne faut pas faire

- Mettre la clé Gemini, ou toute autre clé de service, dans `app/` — sous aucune forme,
  y compris « temporairement pour tester ».
- Écrire un plan de repas depuis le client.
- Contourner Zod parce que « la réponse a l'air bonne ».
- Ajouter une dépendance lourde (Redux, une UI kit complète, un ORM) sans nécessité
  démontrée — la v1 doit rester lisible.
- Committer `google-services.json`, `.env`, ou un fichier de clé de service account.
- Modifier ce document sans que le code suive, ou l'inverse.

---

## 11. Avancement

| Jour          | État     | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1            | **fait** | Monorepo, domaine partagé (30 tests), Security Rules + leurs tests, `joinHousehold`, auth e-mail, écran de foyer partagé, navigation des 6 écrans, thème clair/sombre                                                                                                                                                                                                                                                     |
| J2            | **fait** | `generateWeeklyPlan` déployée : prompt versionné, `responseSchema`, validation Zod puis contraintes métier, unique retry, écriture Firestore en batch, écran d'accueil avec repas du jour                                                                                                                                                                                                                                 |
| J3            | **fait** | Écran planning des 7 jours, `regenerateMeal` : contraintes locales au jour, recalcul complet des courses, `MealCard` partagé entre accueil et planning                                                                                                                                                                                                                                                                    |
| J4            | **fait** | Liste de courses : rendu dans l'ordre de parcours du magasin, cases à cocher synchronisées entre les deux téléphones, partage par le share sheet — lisible par un humain comme par l'import de Listonic                                                                                                                                                                                                                   |
| J5            | **fait** | Fiche recette, historique des 12 dernières semaines, favoris branchés sur le prompt, réglages sortis des onglets                                                                                                                                                                                                                                                                                                          |
| Batch         | **fait** | Semaine du samedi au vendredi, `batchRecipeIds`, contraintes de portions et de congélation, callable `setMeal`, écran de préparation, sélecteurs de semaine, carte d'action sur l'accueil                                                                                                                                                                                                                                 |
| J6            | **fait** | Cache offline du plan, des recettes et des courses ; indicateur « hors ligne » ; verrou empêchant deux générations simultanées sur une même semaine                                                                                                                                                                                                                                                                       |
| Dislike       | **fait** | Bannissement d'un plat par son nom : `isDisliked`, mémoire du foyer à trois listes, filet de validation, boutons sur la fiche recette et la feuille de choix                                                                                                                                                                                                                                                              |
| Goûts         | **fait** | Favoris et plats bannis réunis sur un écran unique atteint des réglages — ce sont les deux valeurs d'un même champ, les séparer cachait le lien. `SegmentedSwitch` extrait de `WeekSwitch`, `splitByVerdict` dans le domaine                                                                                                                                                                                              |
| CI            | **fait** | GitHub Actions sur chaque push et chaque PR ; `.nvmrc` comme source unique de la version de Node ; Renovate en tableau de bord, les paquets du SDK Expo exclus au profit d'`expo install --check`                                                                                                                                                                                                                         |
| Montées       | **fait** | `firebase-tools` 15, `firebase-admin` 14, Vitest 5 (par la v4), `@google/genai` 2. Seuil de couverture appliqué par la CI. Plus aucune faille critique ni élevée                                                                                                                                                                                                                                                          |
| Audit final   | **fait** | La reprise de contenu vivait en quatre copies, une par chaîne de génération : réunie dans `content-retry.ts`. Le bloc « saturé, génération rendue » en quatre copies identiques, `readPlanOrFail` en trois, la lecture de recettes en quatre variantes dont une copie exacte : tout réuni. CLAUDE.md remis d'aplomb sur les quatre suites de tests                                                                        |
| Mise en place | **fait** | Le partage des ingrédients coupés d'un coup, calculé depuis les recettes : une carte en tête du déroulé, et une ligne sous chaque étape qui mêle plusieurs plats                                                                                                                                                                                                                                                          |
| Déroulé       | **fait** | Vue « tout en parallèle » sur l'écran de préparation : les étapes des plats fondues par Gemini, chacune nommant son plat, composées à la demande puis conservées. Un déroulé périmé par un remplacement de plat est détecté au plan, pas effacé par chaque écrivain                                                                                                                                                       |
| Plat du batch | **fait** | Remplacer un plat met à jour tous les repas qu'il servait, depuis l'écran de préparation. Callable, prompt et validation dédiés                                                                                                                                                                                                                                                                                           |
| Décongélation | **fait** | Rappel sur l'accueil le soir où il sert, plutôt que sur l'écran de préparation trois jours trop tôt                                                                                                                                                                                                                                                                                                                       |
| Tests app     | **fait** | Première suite sur `app/` : reprise des abonnements, stockage local, contrat des callables. Ce qu'elle ne couvre pas est écrit au §9 plutôt que passé sous silence                                                                                                                                                                                                                                                        |
| Dimanche      | **fait** | Écran maintenu allumé pendant le batch, étapes cochables et persistées localement. Et deux restes de la migration vers la semaine du samedi : le prompt de remplacement annonçait au modèle « dayIndex 0 à 4 » pour les jours de semaine, et la sonde exerçait le jour 1 en croyant tester un mardi                                                                                                                       |
| Outillage     | **fait** | knip contre le code mort (7 dépendances mortes trouvées d'emblée), sept paquets `expo-*` retirés de l'APK, TypeScript exclu du contrôle de version d'Expo pour que son alerte reste vraie                                                                                                                                                                                                                                 |
| Audit         | **fait** | Le domaine déclarait trois règles que ses consommateurs réimplémentaient : `requiresFreezing` unifie deux copies de `[5, 6]`, `describeViolations` était morte pendant que le prompt de reprise recopiait son corps, `BATCH_DAY_INDEX` existait pendant que `batch.ts` codait `1` en dur. Lint et knip silencieux, faux positifs justifiés dans les configs                                                               |
| Lint          | **fait** | oxlint remplace ESLint : les quatre workspaces couverts au lieu d'un seul, trois imports morts trouvés d'emblée, et TypeScript 7 débloqué — `@typescript-eslint` plafonnait le projet sous TS 6                                                                                                                                                                                                                           |
| Courses       | **fait** | « Acheté = cuisiné » : liste au prorata des repas servis, arrondi une fois vers le haut, même fonction que l'écran du dimanche. Origine des articles et légende, ajout et suppression à la main bornés par leur règle, rayons `entretien` et `hygiene`, table de ~740 articles pour deviner le rayon. Export Listonic retiré. Socle de la refonte : répartition 8/6/6, dates en français, saisons du Centre               |
| Refonte       | **fait** | Plan réduit au batch : portions imposées et vérifiées, végétariens comptés, plat qui cuit seul, `cookMinutes`, saisons dans le prompt (v8). Samedi et dimanche à décider ; restes de la semaine précédente, échange de deux repas, plat jamais vidé ; `regenerateMeal` limité au week-end. Composition limitée à la semaine prochaine, jamais entamée. Lexique des rayons partagé par le foyer. Dates en français partout |
| Dimanche 2    | **fait** | « Tout en parallèle » remplacé par « Mise en place puis cuisson » : mise en place calculée dans l'ordre de la planche, sans placard, quantités des portions cuisinées ; découpes et étapes de cuisson réécrites par Gemini (prompt v9), fiches du plus long au plus court. Collection `batchSessions`. Les quatre chaînes sondées contre Gemini                                                                           |
| Dimanche 3    | **fait** | Mise en place : groupe Aromates en tête, herbes en branche exclues, une ligne par ingrédient quelle que soit l'unité. Temps de cuisson : concordance vérifiée entre `cookMinutes` et les durées des étapes, à la génération comme dans la session, qui rend son temps par plat (prompt v10)                                                                                                                               |
| J7            | à faire  | Build EAS, installation, premier vrai dimanche                                                                                                                                                                                                                                                                                                                                                                            |

Ce qui reste à faire hors code, dans l'ordre :

1. ~~Projet Firebase, Auth e-mail, Firestore `europe-west1`, `app/.env`.~~ Fait.
2. ~~Plan Blaze et alerte de budget.~~ Fait.
3. ~~`GEMINI_API_KEY` dans Secret Manager.~~ Fait — la clé appartient à un projet
   Google Cloud sans facturation, distinct de `dimanche-batch`.
4. ~~Nettoyage d'Artifact Registry.~~ Fait via
   `firebase functions:artifacts:setpolicy --location europe-west1 --days 7` :
   les images de plus de 7 jours sont supprimées automatiquement.
5. ~~Installer un JRE pour faire tourner la suite d'émulateurs.~~ Fait
   (OpenJDK 21). `npm run test:all` passe en entier.
6. **Projet de dev `dimanche-batch-dev`** : le créer, activer l'Auth e-mail,
   Firestore en `europe-west1`, le plan Blaze avec une alerte de budget, les
   deux rôles du compte de service ci-dessous ; ajouter une app Android et
   reporter sa configuration dans `app/.env.development` et dans l'environnement
   EAS `development` ; `firebase functions:secrets:set GEMINI_API_KEY -P dev` ;
   `npm run deploy:dev`.
7. **Environnement EAS `development`** : y créer les six `EXPO_PUBLIC_FIREBASE_*`
   du projet de dev — le profil `preview` s'y rattache désormais.

| Retrait       | **fait** | Retirer un plat du batch quand le frigo est plein : callable `removeBatchRecipe`, sans Gemini ni quota, ses repas passent à décider. Vider le dernier repas d'un plat par un reste ou un repas dehors le retire aussi. Portion du batch possible sur un créneau libre en semaine ; l'accueil compte les repas à décider sur toute la semaine                                                                              |
Le compte de service `<numéro>-compute@developer.gserviceaccount.com` doit porter
**deux rôles** que Google n'accorde plus par défaut sur les projets récents :

| Rôle                        | Sans lui                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Cloud Build Service Account | Le déploiement échoue à la construction, sans nommer le rôle manquant              |
| Utilisateur Cloud Datastore | Les functions se déploient mais tout accès Firestore renvoie `7 PERMISSION_DENIED` |

Ce refus-là ne vient jamais des Security Rules : l'admin SDK n'y est pas soumis.
Chercher le problème dans `firestore.rules` est une impasse.
| Profil        | **fait** | L'onglet Historique devient Profil : foyer, code d'invitation, historique, rayons, goûts, apparence et compte au même endroit. Affichage robuste à la police système, à la navigation à trois boutons et au clavier                                                                                                                                                                                                       |
