import { z } from 'zod';

/**
 * Rayons de supermarché. Sert au regroupement de la liste de courses et fait
 * partie du contrat imposé à Gemini : chaque ingrédient doit porter un rayon.
 * L'ordre du tableau est l'ordre d'affichage dans la liste de courses — il suit
 * un parcours de magasin classique, pas l'ordre alphabétique.
 *
 * `entretien` et `hygiene` ne viennent jamais d'une recette : ils existent parce
 * que la liste de courses est celle du foyer et non celle du batch. Un sac
 * poubelle ajouté à la main doit tomber quelque part, et le faire tomber dans
 * `autre` obligerait à traverser le magasin deux fois.
 */
export const AISLES = [
  'fruits-legumes',
  'boucherie',
  'poissonnerie',
  'cremerie',
  'boulangerie',
  'epicerie',
  'surgeles',
  'boissons',
  'entretien',
  'hygiene',
  'autre',
] as const;

export const AisleSchema = z.enum(AISLES);

export const AISLE_LABELS: Record<Aisle, string> = {
  'fruits-legumes': 'Fruits & légumes',
  boucherie: 'Boucherie',
  poissonnerie: 'Poissonnerie',
  cremerie: 'Crèmerie',
  boulangerie: 'Boulangerie',
  epicerie: 'Épicerie',
  surgeles: 'Surgelés',
  boissons: 'Boissons',
  entretien: 'Entretien',
  hygiene: 'Hygiène',
  autre: 'Autre',
};

/**
 * Unités autorisées. Volontairement restreint : chaque unité doit être
 * convertible dans une dimension connue pour que l'agrégation de la liste de
 * courses soit fiable. Voir `domain/units.ts`.
 */
export const UNITS = [
  'g',
  'kg',
  'ml',
  'cl',
  'l',
  'piece',
  'cas',
  'cac',
  'pincee',
  'botte',
  'gousse',
] as const;

export const UnitSchema = z.enum(UNITS);

/**
 * Étiquettes de recette.
 *
 * `congelable` gouverne la fin de semaine, `vegetarien` le compte que le foyer
 * choisit avant de générer, `mijote` et `four-lent` l'organisation du dimanche :
 * un plat qui cuit longtemps sans surveillance libère le cuisinier pour les
 * autres.
 *
 * **On n'en retire jamais une valeur** : les recettes déjà en base les portent,
 * et un document qui ne passe pas son schéma disparaît de l'app. `weekend` n'est
 * plus demandé au modèle mais reste valide pour cette raison.
 */
export const RECIPE_TAGS = [
  'one-pot',
  'healthy',
  'congelable',
  'rapide',
  'vegetarien',
  'batch',
  'weekend',
  'entree',
  'dessert',
  'mijote',
  'four-lent',
] as const;

export const RecipeTagSchema = z.enum(RECIPE_TAGS);

/** Date au format ISO `YYYY-MM-DD`, sans composante horaire ni fuseau. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format YYYY-MM-DD');

/** Identifiant de semaine : la date ISO du samedi. Sert de clé de document. */
export const WeekIdSchema = IsoDateSchema;

export type Aisle = z.infer<typeof AisleSchema>;
export type Unit = z.infer<typeof UnitSchema>;
export type RecipeTag = z.infer<typeof RecipeTagSchema>;
export type IsoDate = z.infer<typeof IsoDateSchema>;
export type WeekId = z.infer<typeof WeekIdSchema>;
