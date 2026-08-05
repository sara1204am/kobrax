import { createHash, randomBytes } from 'node:crypto';

/**
 * Código de invitación (CUENTA · S2-D3). Es **un solo secreto** que sirve para las dos
 * formas de llegar: el link `kobrax://invitacion?c=…` del correo y el código escrito a
 * mano en la app. Dos tokens habrían sido dos columnas y dos validaciones para el mismo
 * permiso.
 *
 * Alfabeto Crockford base32 (sin `I`, `L`, `O`, `U`): son 32 símbolos exactos, así que
 * `byte % 32` reparte parejo — sin sesgo y sin bucle de rechazo.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 10 símbolos = 50 bits. Suficiente contra fuerza bruta (hasheado, 7 días, rate limit) y tipeable. */
const LENGTH = 10;

export function newInvitationCode(): string {
  const bytes = randomBytes(LENGTH);
  let code = '';
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

/** Cómo se muestra en el correo: `K7F29-QX3TM`. El guión es sólo presentación. */
export function formatInvitationCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Lo que el usuario escribe → lo que se compara. Tolera guiones, espacios y minúsculas,
 * y corrige las confusiones que el alfabeto ya excluye (`O`→`0`, `I`/`L`→`1`): quien lo
 * copia a mano de un correo las va a cometer.
 */
export function normalizeInvitationCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Nunca se guarda el código: se guarda esto (mismo esquema que `PasswordResetToken`). */
export function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
