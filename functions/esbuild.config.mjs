import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

/**
 * Bundle de déploiement.
 *
 * Cloud Build ne reçoit que le dossier `functions/` et y lance une
 * installation npm : une dépendance de workspace comme `@dimanche-batch/shared`
 * y est introuvable, puisqu'elle n'est publiée sur aucun registre. Elle n'est
 * donc déclarée nulle part dans package.json — ni en dépendance, ni en
 * dépendance de développement — et son code est intégré à l'artefact.
 *
 * L'alias pointe la source TypeScript : esbuild la compile au passage, ce qui
 * évite d'avoir à construire `packages/shared/dist` avant chaque déploiement.
 *
 * Tout ce qui figure dans `dependencies` reste externe : Cloud Build sait les
 * installer, et les embarquer gonflerait l'artefact sans bénéfice.
 */
const here = dirname(fileURLToPath(import.meta.url));
const sharedEntry = resolve(here, '../packages/shared/src/index.ts');

await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'lib/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['firebase-functions', 'firebase-admin', '@google/genai', 'zod'],
  alias: { '@dimanche-batch/shared': sharedEntry },
  logLevel: 'info',
});
