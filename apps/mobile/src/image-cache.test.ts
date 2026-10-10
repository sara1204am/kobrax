const mockMeta = new Map<string, string>();
const mockFiles = new Map<string, number>();
let mockDownloadStatus = 200;

jest.mock('./db', () => ({
  getMeta: jest.fn(async (k: string) => mockMeta.get(k) ?? null),
  setMeta: jest.fn(async (k: string, v: string) => void mockMeta.set(k, v)),
}));
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///doc/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async (path: string) =>
    mockFiles.has(path) ? { exists: true, size: mockFiles.get(path) } : { exists: false },
  ),
  downloadAsync: jest.fn(async (_url: string, path: string) => {
    if (mockDownloadStatus === 200) mockFiles.set(path, 10);
    return { status: mockDownloadStatus, uri: path };
  }),
  deleteAsync: jest.fn(async (path: string) => {
    if (path.endsWith('/')) [...mockFiles.keys()].filter((k) => k.startsWith(path)).forEach((k) => mockFiles.delete(k));
    else mockFiles.delete(path);
  }),
}));

import { cacheNameOf, cachedImagePath, clearImageCache, ensureImage, planEviction } from './image-cache';

const HASH = 'a'.repeat(64);
const URL = `https://api.example/uploads/${HASH}.jpg`;

beforeEach(() => {
  mockMeta.clear();
  mockFiles.clear();
  mockDownloadStatus = 200;
});

describe('cacheNameOf', () => {
  it('toma el nombre <sha256>.<ext> de la URL del servidor', () => {
    expect(cacheNameOf(URL)).toBe(`${HASH}.jpg`);
    expect(cacheNameOf(`/api/uploads/${HASH}.PNG?x=1`)).toBe(`${HASH}.png`);
  });
  it('lo que no es una foto de la API no se cachea', () => {
    expect(cacheNameOf('https://otro.com/foto.jpg')).toBeNull();
    expect(cacheNameOf('/api/uploads/../../etc/passwd')).toBeNull();
  });
});

describe('planEviction (menos usada primero, nunca la pedida)', () => {
  const idx = { a: { size: 10, usedAt: 1 }, b: { size: 10, usedAt: 3 }, c: { size: 10, usedAt: 2 } };
  it('bajo el tope no saca nada', () => expect(planEviction(idx, 30)).toEqual([]));
  it('saca la más vieja hasta entrar', () => expect(planEviction(idx, 20)).toEqual(['a']));
  it('si hace falta, saca varias en orden de uso', () => expect(planEviction(idx, 10)).toEqual(['a', 'c']));
  it('no saca la que se acaba de pedir aunque sea la más vieja', () => expect(planEviction(idx, 20, 'a')).toEqual(['c']));
});

describe('ensureImage', () => {
  it('descarga con la sesión, la deja en la carpeta durable y la indexa', async () => {
    const path = await ensureImage(URL, 'tok', 100);
    expect(path).toBe(`file:///doc/image-cache/${HASH}.jpg`);
    expect(JSON.parse(mockMeta.get('image-cache.index')!)[`${HASH}.jpg`]).toEqual({ size: 10, usedAt: 100 });
  });

  it('la segunda vez sale de la caché sin descargar', async () => {
    await ensureImage(URL, 'tok', 100);
    const fs = jest.requireMock('expo-file-system') as { downloadAsync: jest.Mock };
    fs.downloadAsync.mockClear();
    expect(await ensureImage(URL, 'tok', 200)).toBe(`file:///doc/image-cache/${HASH}.jpg`);
    expect(fs.downloadAsync).not.toHaveBeenCalled();
    expect(await cachedImagePath(URL, 300)).not.toBeNull();
  });

  it('un 404 no deja basura ni devuelve ruta', async () => {
    mockDownloadStatus = 404;
    expect(await ensureImage(URL, 'tok')).toBeNull();
    expect(mockFiles.size).toBe(0);
  });

  it('cerrar sesión borra las fotos', async () => {
    await ensureImage(URL, 'tok');
    await clearImageCache();
    expect(mockFiles.size).toBe(0);
    expect(await cachedImagePath(URL)).toBeNull();
  });
});
