const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Monorepo : Metro doit surveiller la racine pour voir `packages/shared`,
// et résoudre les modules depuis les deux dossiers node_modules.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// `@dimanche-batch/shared` est consommé en TypeScript source via la condition
// d'export "react-native" : Metro le transpile comme le reste de l'app.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
