import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Initialisation unique de l'admin SDK, partagée par toutes les functions.
 * L'admin SDK contourne les Security Rules — c'est précisément pourquoi les
 * écritures de plans et de recettes passent par ici et jamais par le client.
 */
if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
