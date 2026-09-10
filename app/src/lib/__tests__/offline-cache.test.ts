import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const store = new Map<string, string>();
const getItem = vi.fn(async (key: string) => store.get(key) ?? null);
const setItem = vi.fn(async (key: string, value: string) => void store.set(key, value));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: (k: string) => getItem(k), setItem: (k: string, v: string) => setItem(k, v) },
}));

const { cacheKeys, readCache, writeCache } = await import('../offline-cache');

/**
 * Ce qui est relu ici a été écrit par une version antérieure de l'app, peut-être
 * avec un autre schéma. Ces tests fixent la seule garantie qui compte : une
 * donnée périmée ou corrompue rend `null` — jamais une valeur à moitié juste,
 * qui ressortirait trois écrans plus loin.
 */
const Schema = z.object({ name: z.string(), qty: z.number() });

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('readCache', () => {
  it('relit ce qui a été écrit', async () => {
    await writeCache('cle', { name: 'riz', qty: 2 });
    await expect(readCache('cle', Schema)).resolves.toEqual({ name: 'riz', qty: 2 });
  });

  it('rend null quand rien n’a été écrit', async () => {
    await expect(readCache('absente', Schema)).resolves.toBeNull();
  });

  it('rend null sur un JSON illisible plutôt que de jeter', async () => {
    store.set('cle', '{ceci n’est pas du JSON');
    await expect(readCache('cle', Schema)).resolves.toBeNull();
  });

  // Le cas qui compte vraiment : un schéma qui a changé entre deux versions.
  it('rend null quand la donnée ne correspond plus au schéma', async () => {
    store.set('cle', JSON.stringify({ name: 'riz' }));
    await expect(readCache('cle', Schema)).resolves.toBeNull();
  });

  it('rend null si le disque refuse de répondre', async () => {
    getItem.mockRejectedValueOnce(new Error('disque plein'));
    await expect(readCache('cle', Schema)).resolves.toBeNull();
  });
});

describe('writeCache', () => {
  // Écrire le cache est un confort, jamais une condition de fonctionnement.
  it('n’échoue pas quand le disque refuse d’écrire', async () => {
    setItem.mockRejectedValueOnce(new Error('disque plein'));
    await expect(writeCache('cle', { name: 'riz', qty: 2 })).resolves.toBeUndefined();
  });
});

describe('cacheKeys', () => {
  it('sépare les foyers et les semaines', () => {
    expect(cacheKeys.weeklyPlan('foyer-a', '2026-09-12')).not.toBe(
      cacheKeys.weeklyPlan('foyer-b', '2026-09-12'),
    );
    expect(cacheKeys.weeklyPlan('foyer-a', '2026-09-12')).not.toBe(
      cacheKeys.weeklyPlan('foyer-a', '2026-09-19'),
    );
  });

  // L'avancement du batch est un état local, pas un cache de données serveur :
  // le préfixe le dit, et un futur vidage du cache ne doit pas l'emporter.
  it('distingue l’avancement du batch du cache serveur', () => {
    expect(cacheKeys.batchProgress('foyer', '2026-09-12')).toMatch(/^progress\./);
    expect(cacheKeys.weeklyPlan('foyer', '2026-09-12')).toMatch(/^cache\./);
  });
});
