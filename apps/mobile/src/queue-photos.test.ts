/**
 * Las fotos de la cola viven en un directorio que no se borra solo. Se prueba que se copien, que se borre SÓLO
 * lo que es de la cola (jamás la foto original del usuario) y que un archivo que desapareció se detecte.
 */
const mockFs = {
  documentDirectory: 'file:///docs/' as string | null,
  copied: [] as { from: string; to: string }[],
  deleted: [] as string[],
  dirs: [] as string[],
  exists: true,
  copyFails: false,
  infoThrows: false,
};

jest.mock('expo-file-system', () => ({
  get documentDirectory() {
    return mockFs.documentDirectory;
  },
  makeDirectoryAsync: jest.fn(async (dir: string) => void mockFs.dirs.push(dir)),
  copyAsync: jest.fn(async (opts: { from: string; to: string }) => {
    if (mockFs.copyFails) throw new Error('disco lleno');
    mockFs.copied.push(opts);
  }),
  getInfoAsync: jest.fn(async () => {
    if (mockFs.infoThrows) throw new Error('boom');
    return { exists: mockFs.exists };
  }),
  deleteAsync: jest.fn(async (uri: string) => void mockFs.deleted.push(uri)),
}));

import { deleteQueuePhoto, isQueuePhoto, persistPhoto, photoExists } from './queue-photos';

beforeEach(() => {
  mockFs.documentDirectory = 'file:///docs/';
  mockFs.copied.length = 0;
  mockFs.deleted.length = 0;
  mockFs.dirs.length = 0;
  mockFs.exists = true;
  mockFs.copyFails = false;
  mockFs.infoThrows = false;
});

describe('persistPhoto', () => {
  it('copia la foto de la cámara a documentDirectory/queue-photos/ y devuelve la ruta nueva', async () => {
    const r = await persistPhoto({ uri: 'file:///cache/ImagePicker/abc.jpg', mimeType: 'image/jpeg' });
    expect(r.uri).toMatch(/^file:\/\/\/docs\/queue-photos\/[0-9a-f-]{36}\.jpg$/);
    expect(r.mimeType).toBe('image/jpeg');
    expect(mockFs.dirs).toEqual(['file:///docs/queue-photos/']);
    expect(mockFs.copied).toEqual([{ from: 'file:///cache/ImagePicker/abc.jpg', to: r.uri }]);
  });

  it('conserva la extensión original (png)', async () => {
    const r = await persistPhoto({ uri: 'file:///cache/x.PNG' });
    expect(r.uri.endsWith('.png')).toBe(true);
  });

  it('sin extensión usa la del mime type', async () => {
    expect((await persistPhoto({ uri: 'content://media/42', mimeType: 'image/png' })).uri.endsWith('.png')).toBe(true);
    expect((await persistPhoto({ uri: 'content://media/42' })).uri.endsWith('.jpg')).toBe(true);
  });

  it('una foto que ya está en la carpeta de la cola no se vuelve a copiar', async () => {
    const foto = { uri: 'file:///docs/queue-photos/ya.jpg' };
    expect(await persistPhoto(foto)).toBe(foto);
    expect(mockFs.copied).toHaveLength(0);
  });

  // Peor que una foto en caché es no encolar: si no se puede copiar, se usa la ruta original.
  it('si la copia falla, devuelve la ruta original (no pierde la acción)', async () => {
    mockFs.copyFails = true;
    const foto = { uri: 'file:///cache/abc.jpg' };
    expect(await persistPhoto(foto)).toBe(foto);
  });

  it('sin documentDirectory (web/test) devuelve la foto tal cual', async () => {
    mockFs.documentDirectory = null;
    const foto = { uri: 'file:///cache/abc.jpg' };
    expect(await persistPhoto(foto)).toBe(foto);
  });
});

describe('deleteQueuePhoto', () => {
  it('borra la copia de la cola', async () => {
    await deleteQueuePhoto('file:///docs/queue-photos/a.jpg');
    expect(mockFs.deleted).toEqual(['file:///docs/queue-photos/a.jpg']);
  });

  // La foto original es del usuario (su galería): borrarla sería destruir un dato que no es nuestro.
  it('NUNCA borra un archivo fuera de la carpeta de la cola', async () => {
    await deleteQueuePhoto('file:///cache/ImagePicker/abc.jpg');
    await deleteQueuePhoto('content://media/external/images/42');
    expect(mockFs.deleted).toEqual([]);
  });

  it('sin uri no hace nada', async () => {
    await deleteQueuePhoto(undefined);
    expect(mockFs.deleted).toEqual([]);
  });

  it('un error al borrar no hace fallar el envío', async () => {
    const fs = jest.requireMock('expo-file-system') as { deleteAsync: jest.Mock };
    fs.deleteAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(deleteQueuePhoto('file:///docs/queue-photos/a.jpg')).resolves.toBeUndefined();
  });
});

describe('photoExists', () => {
  it('true si el archivo está', async () => {
    expect(await photoExists('file:///docs/queue-photos/a.jpg')).toBe(true);
  });

  it('false si el sistema lo borró', async () => {
    mockFs.exists = false;
    expect(await photoExists('file:///cache/x.jpg')).toBe(false);
  });

  it('una excepción del sistema de archivos cuenta como «no está»', async () => {
    mockFs.infoThrows = true;
    expect(await photoExists('file:///cache/x.jpg')).toBe(false);
  });
});

describe('isQueuePhoto', () => {
  it('reconoce sólo la carpeta de la cola', () => {
    expect(isQueuePhoto('file:///docs/queue-photos/a.jpg')).toBe(true);
    expect(isQueuePhoto('file:///docs/otra/a.jpg')).toBe(false);
    mockFs.documentDirectory = null;
    expect(isQueuePhoto('file:///docs/queue-photos/a.jpg')).toBe(false);
  });
});
