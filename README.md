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
npm run emulators              # Firestore + Auth + Functions en local
npm run dev                    # Expo, à ouvrir dans Expo Go
```

Mettre `EXPO_PUBLIC_USE_EMULATORS=1` dans `app/.env` pour que l'app parle aux
émulateurs plutôt qu'au projet Firebase réel. Sur un téléphone physique,
remplacer aussi `EXPO_PUBLIC_EMULATOR_HOST` par l'IP locale de la machine.

### Vérifier

```bash
npm run typecheck              # les trois workspaces
npm run test                   # logique métier (domaine partagé)
npm run test:rules             # Security Rules, nécessite Java pour l'émulateur
npm run lint
```

### Déployer

```bash
firebase functions:secrets:set GEMINI_API_KEY   # une fois, jamais dans le dépôt
npm run deploy:rules
npm run deploy:functions
npm run build:android                            # APK via EAS
```

## Structure

| Dossier | Rôle |
|---|---|
| `packages/shared` | Schémas Zod, types et logique métier pure. Source unique du domaine. |
| `packages/rules-tests` | Tests des Security Rules contre l'émulateur. |
| `app` | Application Expo (React Native, Expo Router). |
| `functions` | Cloud Functions : seul endroit qui connaît la clé Gemini. |
