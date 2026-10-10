/**
 * Caché de fotos de las ubicaciones (0.5). Una foto de la fachada que el cobrador ya vio con señal tiene que verse sin ella.
 *
 * - Vive en `documentDirectory/image-cache/` (no `cacheDirectory`: Android lo vacía solo, justo cuando falta espacio).
 * - El nombre del archivo es el del servidor (`<sha256>.<ext>`): el contenido es inmutable, así que el nombre ES la clave.
 * - Tope `IMAGE_CACHE_MAX_BYTES` (D-9), con salida por **menos usada primero**. El índice (tamaño y último uso) vive en la
 *   tabla `meta` de SQLite; si se corrompe, se reconstruye leyendo la carpeta.
 * - 🔴 Son fotos de personas y viviendas: **se borran al cerrar sesión** (`clearImageCache`, llamado por `clearSession`).
 *
 * Nada de acá lanza hacia afuera: sin foto en caché la pantalla muestra un recuadro, nunca un error.
 */
import * as FileSystem from 'expo-file-system';
import { IMAGE_CACHE_MAX_BYTES } from '@kobrax/shared';
import { getMeta, setMeta } from './db';

const DIR = 'image-cache/';
const INDEX_KEY = 'image-cache.index';

export interface CacheEntry {
  size: number;
  /** ms de la última vez que se mostró o se descargó. */
  usedAt: number;
}
export type CacheIndex = Record<string, CacheEntry>;

function dir(): string | null {
  const base = FileSystem.documentDirectory;
  return base ? `${base}${DIR}` : null;
}

/** El nombre de archivo que corresponde a una URL del servidor, o `null` si no es una foto servida por la API. */
export function cacheNameOf(url: string): string | null {
  const m = /\/uploads\/([0-9a-f]{64}\.(?:jpe?g|png|webp))(?:\?.*)?$/i.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Qué sacar para que el total no pase del tope: lo menos usado primero, y **nunca** lo que se acaba de pedir (`keep`).
 * Pura: se prueba sin disco.
 */
export function planEviction(index: CacheIndex, maxBytes: number, keep?: string): string[] {
  let total = Object.values(index).reduce((n, e) => n + e.size, 0);
  if (total <= maxBytes) return [];
  const victims: string[] = [];
  const oldest = Object.entries(index)
    .filter(([name]) => name !== keep)
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [name, entry] of oldest) {
    if (total <= maxBytes) break;
    victims.push(name);
    total -= entry.size;
  }
  return victims;
}

async function readIndex(): Promise<CacheIndex> {
  try {
    const raw = await getMeta(INDEX_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' ? (value as CacheIndex) : {};
  } catch {
    return {};
  }
}

async function writeIndex(index: CacheIndex): Promise<void> {
  try {
    await setMeta(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* el índice es una ayuda: sin él, la próxima limpieza reconstruye */
  }
}

/** La ruta local si la foto ya está descargada (y la marca como usada). `null` si no. */
export async function cachedImagePath(url: string, now: number = Date.now()): Promise<string | null> {
  const base = dir();
  const name = cacheNameOf(url);
  if (!base || !name) return null;
  try {
    const path = `${base}${name}`;
    if (!(await FileSystem.getInfoAsync(path)).exists) return null;
    const index = await readIndex();
    if (index[name]) {
      index[name] = { ...index[name]!, usedAt: now };
      await writeIndex(index);
    }
    return path;
  } catch {
    return null;
  }
}

/**
 * La ruta local de la foto: de la caché, o la descarga con la sesión de la persona. `null` = no se pudo (sin red, 404…).
 * Una descarga que pasaría el tope saca antes lo menos usado.
 */
export async function ensureImage(url: string, token: string, now: number = Date.now()): Promise<string | null> {
  const hit = await cachedImagePath(url, now);
  if (hit) return hit;
  const base = dir();
  const name = cacheNameOf(url);
  if (!base || !name) return null;
  try {
    await FileSystem.makeDirectoryAsync(base, { intermediates: true });
    const path = `${base}${name}`;
    const res = await FileSystem.downloadAsync(url, path, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) {
      await FileSystem.deleteAsync(path, { idempotent: true });
      return null;
    }
    const info = await FileSystem.getInfoAsync(path, { size: true });
    const size = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;

    const index = await readIndex();
    index[name] = { size, usedAt: now };
    for (const victim of planEviction(index, IMAGE_CACHE_MAX_BYTES, name)) {
      delete index[victim];
      await FileSystem.deleteAsync(`${base}${victim}`, { idempotent: true });
    }
    await writeIndex(index);
    return path;
  } catch {
    return null;
  }
}

/** Borra todas las fotos guardadas (cierre de sesión). */
export async function clearImageCache(): Promise<void> {
  const base = dir();
  if (!base) return;
  try {
    await FileSystem.deleteAsync(base, { idempotent: true });
    await writeIndex({});
  } catch {
    /* no hay nada que hacer: la carpeta se recrea sola */
  }
}
