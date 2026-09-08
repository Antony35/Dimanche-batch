import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // L'émulateur est lent à démarrer et les tests s'y connectent en série.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
