# Dimanche Batch

Application mobile de batch cooking pour un foyer de deux personnes. Chaque dimanche,
un plan de repas de 7 jours (midi + soir) est généré par l'API Gemini, puis converti en
liste de courses groupée par rayon, partageable vers Listonic. Les deux téléphones
partagent le même foyer et voient les mêmes données en temps réel.

**Statut : v1 en cours — J1 livré** (monorepo, domaine partagé testé, Security
Rules, authentification, foyer partagé, navigation des 6 écrans). La génération
Gemini arrive en J2. Ce document fait autorité sur l'architecture ; il est mis à
jour en même temps que le code, jamais après.

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

| Couche | Choix | Note |
|---|---|---|
| App | Expo (SDK récent) + React Native + TypeScript strict | Android uniquement en v1 |
| Navigation | Expo Router (file-based) | Routes typées |
| État serveur | TanStack Query + listeners Firestore | Pas de Redux |
| État local | React Context minimal (session, foyer) | |
| Données | Firebase Firestore | Temps réel entre les deux téléphones |
| Auth | Firebase Auth — email + mot de passe | Importé depuis `@firebase/auth`, pas `firebase/auth` : voir §7 |
| Cache offline | AsyncStorage, explicite | Le SDK JS Firestore n'a pas de persistance offline sur React Native |
| Backend | Cloud Functions for Firebase (Node 24, 2ᵉ gén.), région `europe-west1` | Plan Blaze, plafond de dépense à définir |
| IA | Gemini API, appelée **uniquement** depuis les Cloud Functions | |
| Validation | Zod, partagé client/serveur | |
| Tests | Vitest sur le domaine pur + `@firebase/rules-unit-testing` sur l'émulateur | L'émulateur exige un JRE installé |
| Lint | ESLint (`eslint-config-expo`), config dans `app/` | |

---

## 3. Structure du dépôt

Monorepo npm workspaces. Ne pas créer de dossier hors de cette arborescence sans
mettre ce document à jour.

```
dimanche-batch/
├─ CLAUDE.md
├─ package.json               # workspaces: app, functions, packages/*
├─ firebase.json              # emulators, rules, functions
├─ firestore.rules
├─ firestore.indexes.json
│
├─ packages/shared/           # aucun import de firebase, react-native ni node
│  └─ src/
│     ├─ schemas/             # Zod : common, household, recipe, weeklyPlan,
│     │                       #       groceryList, gemini (contrat du modèle)
│     ├─ domain/              # logique pure : unités, semaine, agrégation
│     │                       #   courses, export Listonic, contraintes de plan
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

households/{hid}/weeklyPlans/{weekId}      # weekId = date ISO du lundi, ex. 2026-09-14
  weekStart: string
  days: DayPlan[7]             # { date, lunch: RecipeRef, dinner: RecipeRef, starter: bool }
  generatedAt: Timestamp
  generatedBy: string          # uid

households/{hid}/recipes/{recipeId}
  name, servings, prepMinutes, tags[], ingredients[], steps[]
  lastUsedAt: string | null
  isFavorite: boolean

households/{hid}/groceryLists/{weekId}
  itemCount: number            # métadonnées seulement

households/{hid}/groceryLists/{weekId}/items/{itemId}
  name, qty, unit, aisle, checked, fromRecipeIds[]
  # itemId dérivé du nom normalisé + dimension d'unité (domain/grocery.ts)

households/{hid}/usage/{yyyy-mm-dd}        # rate limiting
  generations: number
```

**Security Rules** — l'intention à implémenter :
- Lecture/écriture sous `households/{hid}/**` uniquement si
  `request.auth.uid in get(/households/$(hid)).data.members`.
- `weeklyPlans` et `recipes` : **lecture seule** pour le client. Seules les functions
  (admin SDK) écrivent. Le client ne fabrique pas de plan.
- `groceryLists/{weekId}/items/{itemId}` : le client ne peut modifier que `checked`,
  garanti par `diff().affectedKeys().hasOnly(['checked'])`. C'est la raison d'être
  de la sous-collection : sur un tableau d'items, cocher une case imposerait de
  réécrire tout le document et la règle ne garantirait plus rien. Bénéfice
  secondaire, deux personnes cochent en même temps sans s'écraser.
- `recipes` : même mécanisme, limité à `isFavorite`.
- `households` : `members` est immuable côté client — on ne s'ajoute pas à un
  foyer, et on n'en exclut pas l'autre personne. Seule `joinHousehold` y touche.
- `usage` : lecture seule côté client.

Les règles sont testées avec l'émulateur (`npm run test:rules`, dans
`packages/rules-tests`). Une règle non testée est une règle fausse. Ajouter une
règle sans ajouter son test n'est pas une modification terminée.

---

## 6. Cloud Functions

Une responsabilité par function, nommage `verbeNom`.

| Function | Rôle |
|---|---|
| `generateWeeklyPlan` | Génère le plan de la semaine. Vérifie l'appartenance au foyer et le rate limit, construit le prompt avec l'historique des 3 dernières semaines, appelle Gemini, valide via Zod, écrit `weeklyPlans` + `recipes` + `groceryLists` dans un batch, incrémente `usage`. |
| `regenerateMeal` | Remplace un seul repas d'un plan existant, même chemin de validation. |
| `joinHousehold` | Consomme un code d'invitation et ajoute l'uid aux `members`. Côté serveur pour que le code reste à usage unique. |

Contrat Gemini :
- Réponse en **JSON structuré** (`responseMimeType: application/json` + `responseSchema`),
  pas de parsing de markdown.
- Validation Zod après réception. En cas d'échec : **un seul** retry, puis erreur
  `HttpsError('internal')` avec un message lisible côté app. Jamais de boucle.
- Le prompt vit dans `functions/src/gemini/prompt.ts`, en une seule constante versionnée,
  jamais construit par concaténation dispersée dans le code.

Contraintes métier que le prompt doit garantir (voir la semaine type) : au moins
3 recettes distinctes, one-pot et healthy en semaine, weekend sans contrainte one-pot,
au moins 2 recettes qui se congèlent bien, portions pour 2, ingrédients quantifiés avec
un rayon de supermarché.

---

## 7. Conventions de code

- **TypeScript strict** (`strict: true`, `noUncheckedIndexedAccess: true`). `any` interdit ;
  utiliser `unknown` + validation.
- Types dérivés des schémas Zod (`z.infer`), jamais déclarés en double.
- Composants fonctionnels, un composant par fichier, nommage `PascalCase.tsx`.
- Les hooks de données vivent dans `features/<x>/api/`, préfixés `use` — un composant
  ne consomme jamais le SDK Firestore en direct.
- Pas de valeurs magiques dans le style : tout passe par `theme/`. L'app supporte le
  mode sombre dès la v1 — définir chaque couleur dans les deux thèmes, jamais en dur.
- Textes d'interface en français, code et identifiants en anglais. Apostrophe
  typographique (’) dans le texte affiché, jamais l'apostrophe droite.
- **Auth : importer depuis `@firebase/auth`, pas `firebase/auth`.** Le package
  meta ne publie que la variante navigateur, dépourvue de
  `getReactNativePersistence` — sans elle, la session est perdue à chaque
  redémarrage de l'app. Un `paths` dans `app/tsconfig.json` réaligne le typage
  sur ce que Metro résout réellement.
- Pas de `setState` synchrone dans un `useEffect` : dériver l'état au rendu
  (voir `useHousehold`). La règle est appliquée par le lint.
- Erreurs : jamais de `catch` silencieux. Soit on remonte à l'utilisateur, soit on log
  avec du contexte.
- Commits conventionnels (`feat:`, `fix:`, `chore:`).

---

## 8. Commandes

Tous depuis la racine du dépôt.

```bash
npm install                      # installe tous les workspaces
npm run build:shared             # requis avant tout déploiement de functions
npm run dev                      # Expo dev server
npm run emulators                # Firestore + Auth + Functions en local
npm run test                     # Vitest sur le domaine partagé
npm run test:rules               # Security Rules sur émulateur (nécessite Java)
GEMINI_API_KEY=… npm run gemini:probe   # chaîne de génération, sans déployer
npm run typecheck                # tsc --noEmit sur tous les workspaces
npm run lint
npm run deploy:rules
npm run deploy:functions
npm run build:android            # eas build -p android --profile preview (APK)
```

`gemini:probe` envoie à Gemini le payload réel de `generateWeeklyPlan`, puis fait
traverser la réponse les deux mêmes filtres que la function. **À lancer avant tout
changement de modèle ou de `responseSchema`** : l'API refuse certaines
constructions de schéma avec un `INVALID_ARGUMENT` qui ne nomme aucun champ, et
publie des modèles fermés aux comptes récents qui répondent 404 alors qu'ils
figurent dans `GET /models`. Dans les deux cas, seul un appel réel tranche, et
diagnostiquer depuis une function déployée coûte un cycle de déploiement plus
l'attente d'ingestion des logs.

**Développer contre l'émulateur par défaut** (`EXPO_PUBLIC_USE_EMULATORS=1` dans
`app/.env`). Ne pointer vers le projet Firebase réel que pour un test de bout en
bout explicite — un appel Gemini réel consomme du quota. Sur téléphone physique,
`EXPO_PUBLIC_EMULATOR_HOST` doit valoir l'IP locale de la machine ; la valeur par
défaut `10.0.2.2` ne vaut que pour l'émulateur Android.

---

## 9. Périmètre v1 et points d'extension

Ce qui est **délibérément** simple en v1, et où brancher la suite :

| Raccourci v1 | Pourquoi | Extension v2 |
|---|---|---|
| Un seul foyer par utilisateur | Usage à deux, pas de cas multi-foyer | `members` est déjà un tableau ; ajouter un sélecteur de foyer |
| Auth email + mot de passe | Zéro dépendance native, build simple | Ajouter Google Sign-In (provider Firebase, pas de migration de données) |
| Partage Listonic via share sheet texte | Pas d'API publique fiable | Isoler le formatage dans `shared/domain/groceryExport.ts` pour brancher une vraie intégration |
| Pas de saisie manuelle de recette | L'IA couvre le besoin initial | Les `recipes` sont déjà une collection à part entière ; il suffit d'un écran d'édition |
| Pas de gestion des restes du frigo | Hors périmètre | Nouveau champ d'entrée du prompt, pas de changement de schéma |
| App Check désactivé | L'auth suffit pour deux utilisateurs | Activer et exiger le token dans les callables |
| Android uniquement | Les deux téléphones sont Android | Expo est cross-platform : ne jamais écrire de code Android-spécifique sans garde `Platform` |

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

| Jour | État | Contenu |
|---|---|---|
| J1 | **fait** | Monorepo, domaine partagé (30 tests), Security Rules + leurs tests, `joinHousehold`, auth e-mail, écran de foyer partagé, navigation des 6 écrans, thème clair/sombre |
| J2 | **fait** | `generateWeeklyPlan` déployée : prompt versionné, `responseSchema`, validation Zod puis contraintes métier, unique retry, écriture Firestore en batch, écran d'accueil avec repas du jour |
| J3 | à faire | Écran planning des 7 jours, `regenerateMeal` |
| J4 | à faire | Liste de courses : rendu par rayon, cases à cocher, partage Listonic |
| J5 | à faire | Fiche recette, historique, favoris, anti-répétition dans le prompt |
| J6 | à faire | Synchro à deux téléphones, cache offline, cas limites |
| J7 | à faire | Build EAS, installation, premier vrai dimanche |

Ce qui reste à faire hors code, dans l'ordre :

1. ~~Projet Firebase, Auth e-mail, Firestore `europe-west1`, `app/.env`.~~ Fait.
2. ~~Plan Blaze et alerte de budget.~~ Fait.
3. ~~`GEMINI_API_KEY` dans Secret Manager.~~ Fait — la clé appartient à un projet
   Google Cloud sans facturation, distinct de `dimanche-batch`.
4. ~~Nettoyage d'Artifact Registry.~~ Fait via
   `firebase functions:artifacts:setpolicy --location europe-west1 --days 7` :
   les images de plus de 7 jours sont supprimées automatiquement.
5. Installer un JRE pour faire tourner la suite d'émulateurs (`npm run test:rules`
   en dépend). Seul point encore ouvert.

Le compte de service `<numéro>-compute@developer.gserviceaccount.com` doit porter
**deux rôles** que Google n'accorde plus par défaut sur les projets récents :

| Rôle | Sans lui |
|---|---|
| Cloud Build Service Account | Le déploiement échoue à la construction, sans nommer le rôle manquant |
| Utilisateur Cloud Datastore | Les functions se déploient mais tout accès Firestore renvoie `7 PERMISSION_DENIED` |

Ce refus-là ne vient jamais des Security Rules : l'admin SDK n'y est pas soumis.
Chercher le problème dans `firestore.rules` est une impasse.
