/**
 * Cifrado en reposo del caché y de la cola (0.7, D-3). La base `kobrax.db` guardaba fichas de personas y cobros pendientes en
 * texto plano: con el teléfono rooteado o un respaldo, eso se leía entero.
 *
 * - **XChaCha20-Poly1305** (`@noble/ciphers`, JS puro): confidencialidad + integridad. Una fila alterada NO descifra.
 * - La **llave** (32 bytes aleatorios) vive en `expo-secure-store` (Keystore/Keychain) y nunca en SQLite. Se crea la primera vez
 *   y **no se borra al cerrar sesión**: la cola sobrevive al logout y tiene que seguir siendo legible.
 * - El nonce (24 bytes) sale de `expo-crypto` (Hermes no trae `crypto.getRandomValues`) y viaja delante del texto cifrado.
 * - Formato: `enc1:<hex nonce><hex cifrado>`. Lo que no lleva el prefijo es una fila **anterior** al cifrado: se lee igual
 *   (no se pierde cola) y se reescribe cifrada en la próxima vuelta. Así no hace falta subir `SCHEMA_VERSION` (que borraría la cola).
 *
 * 🔴 Sin llave disponible NO se escribe caché (es descartable); la **cola sí** se escribe, porque perder un cobro es peor que
 * guardarlo en claro, y lo dice el log. Una fila ilegible (llave perdida, dato alterado) en el caché se descarta; en la cola
 * `open` devuelve `null` y `parseAction` la muestra como «no soportada» con su motivo: nunca se borra en silencio.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils';

export const ENC_PREFIX = 'enc1:';
const KEY_NAME = 'kobrax.db.key';
const NONCE_BYTES = 24;

let keyPromise: Promise<Uint8Array | null> | null = null;

/** Para los tests. */
export function resetKeyForTests(): void {
  keyPromise = null;
}

async function loadKey(): Promise<Uint8Array | null> {
  try {
    const stored = await SecureStore.getItemAsync(KEY_NAME);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return hexToBytes(stored);
    const fresh = Crypto.getRandomBytes(32);
    await SecureStore.setItemAsync(KEY_NAME, bytesToHex(fresh), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    return fresh;
  } catch {
    return null;
  }
}

/** La llave, o `null` si el almacén seguro no responde. Se resuelve una vez por proceso. */
export function getKey(): Promise<Uint8Array | null> {
  keyPromise ??= loadKey().then((k) => {
    if (!k) keyPromise = null; // que el próximo intento vuelva a probar
    return k;
  });
  return keyPromise;
}

export const isSealed = (stored: string): boolean => typeof stored === 'string' && stored.startsWith(ENC_PREFIX);

/** Cifra un texto. `null` = no hay llave (el llamador decide si escribe en claro o no escribe). */
export async function seal(plain: string): Promise<string | null> {
  const key = await getKey();
  if (!key) return null;
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plain));
  return ENC_PREFIX + bytesToHex(nonce) + bytesToHex(cipher);
}

/**
 * Descifra. Un texto sin prefijo es una fila anterior al cifrado y vuelve tal cual. `null` = no se pudo (sin llave, formato roto o
 * dato alterado).
 */
export async function open(stored: string): Promise<string | null> {
  if (typeof stored !== 'string') return null;
  if (!isSealed(stored)) return stored;
  const key = await getKey();
  if (!key) return null;
  try {
    const raw = hexToBytes(stored.slice(ENC_PREFIX.length));
    if (raw.length <= NONCE_BYTES) return null;
    const plain = xchacha20poly1305(key, raw.slice(0, NONCE_BYTES)).decrypt(raw.slice(NONCE_BYTES));
    return bytesToUtf8(plain);
  } catch {
    return null;
  }
}
