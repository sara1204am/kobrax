/**
 * Identificadores generados en el teléfono.
 *
 * Existen para que un alta hecha **sin señal** tenga id desde el primer momento: la cola puede
 * reintentarla sin duplicar (el server reconoce el id y devuelve lo que ya creó) y, sobre todo,
 * el préstamo puede colgarse del cliente que todavía no subió — sin esto habría que esperar a que
 * el server contestara para saber a quién pertenece, que es justo lo que no se puede hacer offline.
 *
 * `ponytail:` UUID v4 sobre `Math.random`, sin dependencias. **No es aleatoriedad criptográfica y
 * no hace falta que lo sea**: esto no es un secreto ni una credencial, es la clave de una fila que
 * el servidor valida contra el tenant de la sesión. Adivinar un id no da acceso a nada — RLS filtra
 * por cuenta. Y la probabilidad de que dos altas colisionen es del orden de 1 en 10^36.
 * Si algún día hace falta un id impredecible (un token, un enlace público), eso pide `expo-crypto`
 * y un módulo nativo; no se usa esta función.
 */
export function nuevoId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8; // variante RFC 4122
    return v.toString(16);
  });
}
