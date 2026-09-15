# Dimanche Batch

Batch cooking du dimanche pour deux : un plan de repas de 7 jours généré par
Gemini, une liste de courses par rayon, synchronisés entre deux téléphones.

Les règles d'architecture et les contraintes du projet sont dans
[CLAUDE.md](./CLAUDE.md) — à lire avant toute modification.

## Démarrer

```bash
npm install
cp app/.env.example app/.env   # puis renseigner la config Firebase du projet
npm run build:shared           # requis une fois, pour les Cloud Functions
```

### Développer

```bash
npm run dev                    # Expo, à ouvrir dans Expo Go — base de test
```

Deux projets Firebase : `dimanche-batch-dev` pour les essais, `dimanche-batch`
pour le foyer. `npm run dev` lit `app/.env.development`, qui pointe sur la base
de test et passe devant `app/.env` ; un bandeau « BASE DE TEST » le rappelle sur
chaque écran. Voir `app/.env.example` et CLAUDE.md §8.

### Vérifier

```bash
npm run typecheck              # les quatre workspaces
npm run lint && npm run knip && npm run format:check
npm run test:all               # domaine, app, functions, Security Rules (Java requis)
```

### Déployer

```bash
firebase functions:secrets:set GEMINI_API_KEY -P dev   # une fois par projet, jamais dans le dépôt
npm run deploy:dev                                      # base de test
npm run deploy:prod                                     # base du foyer
npm run build:android:prod                              # APK du foyer via EAS
```

## Structure

| Dossier                | Rôle                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `packages/shared`      | Schémas Zod, types et logique métier pure. Source unique du domaine. |
| `packages/rules-tests` | Tests des Security Rules contre l'émulateur.                         |
| `app`                  | Application Expo (React Native, Expo Router).                        |
| `functions`            | Cloud Functions : seul endroit qui connaît la clé Gemini.            |
