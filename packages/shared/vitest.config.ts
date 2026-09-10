import { defineConfig } from 'vitest/config';

/**
 * La couverture du domaine partagé, et le seuil qui la garde.
 *
 * Vitest 4 masque du rapport les fichiers entièrement couverts : « absent »
 * y signifie désormais « complet », ce qui rend une règle illisible à l'œil.
 * On l'exprime donc en seuil plutôt qu'en convention — un schéma qui
 * perdrait sa couverture fait échouer la commande au lieu de disparaître
 * discrètement d'un tableau.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**'],
      // Un baril de ré-exports n'a rien à couvrir.
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        // Les schémas gardent les frontières du système : un schéma trop
        // permissif ne se voit nulle part, il laisse simplement passer.
        'src/schemas/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
