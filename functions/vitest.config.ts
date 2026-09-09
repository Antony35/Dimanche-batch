import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // La source, pas `dist` : les tests ne doivent pas dépendre d'un
      // `build:shared` préalable, sous peine de valider une version périmée
      // du domaine sans que rien ne le signale.
      '@dimanche-batch/shared': resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
  test: {
    // Ces tests écrivent dans un émulateur partagé : ils se marchent dessus
    // s'ils tournent en parallèle.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ['./src/__tests__/emulator.ts'],
  },
});
