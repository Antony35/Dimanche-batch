import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Suite de la couche app.
 *
 * Elle ne couvre que la logique qui ne rend rien : ce qui monte un composant
 * demanderait un renderer React, un environnement DOM et une transformation des
 * modules React Native — écrits en Flow — dont ce dépôt n'a rien aujourd'hui.
 * Voir CLAUDE.md §9 : c'est un chantier en soi, et le dire vaut mieux que
 * laisser croire que la couche est couverte.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // La source, pas `dist` : même politique que `functions`.
      '@dimanche-batch/shared': resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
});
