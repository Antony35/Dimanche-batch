import { describe, expect, it } from 'vitest';
import type { Aisle } from '../../schemas/common';
import { AISLES } from '../../schemas/common';
import { aisleOverrideKey, countKnownIngredients, guessAisle, lookupAisle } from '../aisle-lookup';

describe('rayon deviné', () => {
  it('couvre assez d’articles pour être la seule liste du foyer', () => {
    expect(countKnownIngredients()).toBeGreaterThan(600);
  });

  it('classe les aliments dans leur rayon', () => {
    expect(lookupAisle('courgette')).toBe('fruits-legumes');
    expect(lookupAisle('poulet')).toBe('boucherie');
    expect(lookupAisle('cabillaud')).toBe('poissonnerie');
    expect(lookupAisle('yaourt')).toBe('cremerie');
    expect(lookupAisle('baguette')).toBe('boulangerie');
    expect(lookupAisle('lentille corail')).toBe('epicerie');
    expect(lookupAisle('glace')).toBe('surgeles');
    expect(lookupAisle('jus d’orange')).toBe('boissons');
  });

  // La raison d'être des deux nouveaux rayons.
  it('classe les produits ménagers, que jamais aucune recette ne cite', () => {
    expect(lookupAisle('sac poubelle')).toBe('entretien');
    expect(lookupAisle('produit vaisselle')).toBe('entretien');
    expect(lookupAisle('éponge')).toBe('entretien');
    expect(lookupAisle('dentifrice')).toBe('hygiene');
    expect(lookupAisle('papier toilette')).toBe('hygiene');
  });

  it('ignore la casse, les accents, les traits d’union et les apostrophes', () => {
    expect(lookupAisle('Chou-Fleur')).toBe('fruits-legumes');
    expect(lookupAisle('chou fleur')).toBe('fruits-legumes');
    expect(lookupAisle('EPINARD')).toBe('fruits-legumes');
    expect(lookupAisle("huile d'olive")).toBe('epicerie');
    expect(lookupAisle('huile d’olive')).toBe('epicerie');
  });

  it('accepte le pluriel', () => {
    expect(lookupAisle('courgettes')).toBe('fruits-legumes');
    expect(lookupAisle('petits pois')).toBe('fruits-legumes');
    expect(lookupAisle('œufs')).toBe('cremerie');
  });

  /**
   * Le cœur de l'algorithme : le groupe de mots le plus long gagne. Sans cette
   * règle, « sauce tomate » partirait au rayon des fruits et légumes et
   * « épinard surgelé » au frais — deux allers-retours dans le magasin.
   */
  it('préfère le groupe de mots le plus long', () => {
    expect(lookupAisle('sauce tomate')).toBe('epicerie');
    expect(lookupAisle('tomate')).toBe('fruits-legumes');
    expect(lookupAisle('épinard surgelé')).toBe('surgeles');
    expect(lookupAisle('épinard')).toBe('fruits-legumes');
    expect(lookupAisle('lait de coco')).toBe('epicerie');
    expect(lookupAisle('lait')).toBe('cremerie');
    expect(lookupAisle('vinaigre blanc')).toBe('entretien');
    expect(lookupAisle('vinaigre')).toBe('epicerie');
  });

  it('retrouve l’article au milieu d’un libellé bavard', () => {
    expect(lookupAisle('gros sac poubelle 50 litres')).toBe('entretien');
    expect(lookupAisle('filet de poulet fermier')).toBe('boucherie');
  });

  it('ne devine pas ce qu’elle ne connaît pas', () => {
    expect(lookupAisle('zgrouglou')).toBeNull();
    expect(guessAisle('zgrouglou')).toBe('autre');
  });

  it('fait passer le lexique du foyer devant la table livrée', () => {
    const overrides = new Map<string, Aisle>([
      [aisleOverrideKey('Sac Poubelle'), 'autre'],
      [aisleOverrideKey('zgrouglou'), 'epicerie'],
    ]);
    expect(lookupAisle('sac poubelle', overrides)).toBe('autre');
    expect(guessAisle('zgrouglou', overrides)).toBe('epicerie');
    // Sans correction, la table livrée continue de répondre.
    expect(lookupAisle('sac poubelle')).toBe('entretien');
  });

  it('ne rend jamais un rayon inconnu du schéma', () => {
    for (const name of ['courgette', 'sac poubelle', 'zgrouglou', 'thon en boîte']) {
      expect(AISLES).toContain(guessAisle(name));
    }
  });
});
