import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseError } from 'firebase/app';

const callable = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: () => callable,
}));
vi.mock('../firebase', () => ({ functions: {} }));

const { setMeal } = await import('../callables');

/**
 * La réponse d'une callable est du `unknown` du point de vue du client. Ces
 * tests fixent les deux garanties de ce module : une réponse hors contrat est
 * refusée ici plutôt que de crasher un écran trois écrans plus loin, et les
 * messages du serveur — déjà écrits en français — arrivent intacts.
 */
const input = {
  householdId: 'foyer',
  weekId: '2026-09-12',
  date: '2026-09-15',
  slot: 'lunch',
  meal: { choice: 'eat-out' },
} as const;

const validResult = { weekId: '2026-09-12', recipeId: null, recipeName: null, itemCount: 12 };

beforeEach(() => vi.clearAllMocks());

describe('appel d’une callable', () => {
  it('rend la donnée validée', async () => {
    callable.mockResolvedValueOnce({ data: validResult });
    await expect(setMeal(input)).resolves.toEqual(validResult);
  });

  it('refuse une réponse hors contrat et dit quoi faire', async () => {
    callable.mockResolvedValueOnce({ data: { weekId: '2026-09-12' } });
    await expect(setMeal(input)).rejects.toThrow(/Mets l’application à jour/);
  });

  it('nomme la callable fautive dans le message', async () => {
    callable.mockResolvedValueOnce({ data: null });
    await expect(setMeal(input)).rejects.toThrow(/setMeal/);
  });
});

describe('traduction des erreurs', () => {
  // Les `HttpsError` du serveur portent déjà un message en français, écrit pour
  // être lu par quelqu'un qui est devant son téléphone : le réécrire le perdrait.
  it('laisse passer le message du serveur', async () => {
    callable.mockRejectedValueOnce(
      new FirebaseError('functions/resource-exhausted', 'Limite de 10 générations par jour atteinte.'),
    );
    await expect(setMeal(input)).rejects.toThrow('Limite de 10 générations par jour atteinte.');
  });

  it('remplace un message vide par une phrase utile', async () => {
    callable.mockRejectedValueOnce(new FirebaseError('functions/internal', ''));
    await expect(setMeal(input)).rejects.toThrow(/indisponible/);
  });

  it('ne perd pas une erreur qui n’est pas de Firebase', async () => {
    callable.mockRejectedValueOnce(new Error('le réseau a coupé'));
    await expect(setMeal(input)).rejects.toThrow('le réseau a coupé');
  });

  it('rend une erreur lisible même quand ce qui est jeté n’en est pas une', async () => {
    callable.mockRejectedValueOnce('quelque chose');
    await expect(setMeal(input)).rejects.toThrow(/inattendue/);
  });
});
