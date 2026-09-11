/**
 * Point d'entrée unique du domaine partagé.
 *
 * `app` et `functions` importent depuis ici et jamais depuis un chemin interne :
 * la surface publique du package reste explicite, et un déplacement de fichier
 * ne casse pas les deux autres workspaces.
 */

export * from './schemas/common';
export * from './schemas/household';
export * from './schemas/recipe';
export * from './schemas/weekly-plan';
export * from './schemas/grocery-list';
export * from './schemas/gemini';
export * from './schemas/generation';
export * from './schemas/batch-schedule';

export * from './domain/text';
export * from './domain/units';
export * from './domain/week';
export * from './domain/grocery';
export * from './domain/grocery-export';
export * from './domain/plan-constraints';
export * from './domain/plan-edit';
export * from './domain/preferences';
export * from './domain/batch';
export * from './domain/batch-schedule';
export * from './domain/invite';

export * from './firestore-paths';
