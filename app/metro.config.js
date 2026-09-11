const { getDefaultConfig } = require('expo/metro-config');

// Aucune surcharge, à dessein. Depuis le SDK 52, `getDefaultConfig` détecte le
// monorepo tout seul — racine surveillée, `packages/shared` résolu — et les
// exports de paquets sont actifs par défaut : c'est par eux que Metro trouve la
// source TypeScript de `@dimanche-batch/shared`, via la condition
// "react-native". Les réglages de l'ancien guide monorepo d'Expo
// (`disableHierarchicalLookup`, `nodeModulesPaths`) font échouer `expo doctor`.
module.exports = getDefaultConfig(__dirname);
