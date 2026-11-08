import { Permission } from '../enums/permission.enum.js';

/**
 * F14 · F4 (ADR-F14-06, H-5/H-6) — qué categorías de dato personal de un cliente ve cada persona. Una sola regla PURA, compartida por la
 * API (que proyecta las respuestas, los exportes y los PDF) y por la web (que decide qué mostrar). El servidor es quien manda: esto en la
 * web sólo evita ofrecer lo que la API va a negar.
 *
 *   DOCUMENT  documento de identidad y NIT (siempre enmascarados salvo revelado)
 *   CONTACT   teléfonos y correos, direcciones, GPS, zona, notas y fotos de ubicación, personas relacionadas
 *   ECONOMIC  perfil de ingresos, garantías y su valor
 *
 * Los nombres (nombre, apellido, razón social) NO son una categoría: los ve todo el que ve al cliente.
 */
export enum PiiCategory {
  DOCUMENT = 'DOCUMENT',
  CONTACT = 'CONTACT',
  ECONOMIC = 'ECONOMIC',
}

export type PiiChannel = 'web' | 'mobile' | 'api';

/** Lo que la regla necesita saber de quien pregunta. */
export interface PiiActor {
  permissions: readonly string[];
  /** Canal de la petición (`x-client-type`). Desconocido = `api`. */
  channel?: PiiChannel;
  /**
   * D-2 de F4: «el documento va siempre enmascarado y sin revelar en móvil». Apagado por omisión hasta que el móvil se refactorice (F8):
   * su pantalla de edición de cliente todavía pide el revelado.
   */
  mobileMask?: boolean;
}

const has = (a: PiiActor, p: Permission): boolean => a.permissions.includes(p);

/** Normaliza el valor del encabezado `x-client-type`. */
export function piiChannelOf(header: string | undefined | null): PiiChannel {
  const v = (header ?? '').toLowerCase();
  return v === 'mobile' ? 'mobile' : v === 'web' ? 'web' : 'api';
}

/** ¿Ve contactos, direcciones, GPS, fotos de ubicación y personas relacionadas? */
export function canSeeContact(a: PiiActor): boolean {
  return has(a, Permission.CLIENT_CONTACT_READ);
}

/** ¿Ve el perfil económico y las garantías? Mismo conjunto que el contacto (H-5: VIEWER no ve ninguno de los dos). */
export function canSeeEconomic(a: PiiActor): boolean {
  return has(a, Permission.CLIENT_CONTACT_READ);
}

/**
 * Política `pii.reveal`: ¿puede pedir el documento en claro? Hace falta poder leer clientes y el permiso de contacto (la persona
 * de consulta, VIEWER, no revela). En móvil, con el interruptor encendido, nunca. Que el cliente sea visible para la persona
 * (si no, 404) lo resuelve la API con el alcance, no esta función.
 */
export function canReveal(a: PiiActor): boolean {
  if (!has(a, Permission.CLIENT_READ) || !has(a, Permission.CLIENT_CONTACT_READ)) return false;
  if (a.mobileMask === true && a.channel === 'mobile') return false;
  return true;
}

/**
 * F14 · F8 (D-4): ¿puede pedir los CONTACTOS en claro (`?reveal=true`)? Hace falta poder leer clientes y el permiso de contacto. A diferencia del
 * documento (`canReveal`), el canal móvil con la máscara encendida SÍ puede: el cobrador necesita el teléfono y la dirección para cobrar y editar.
 */
export function canRevealContacts(a: PiiActor): boolean {
  return has(a, Permission.CLIENT_READ) && has(a, Permission.CLIENT_CONTACT_READ);
}

/** Alcance «propio»: sin ninguna de las tres capacidades de alcance mayor (la misma idea que `officeScopeKindOf` de la API). */
export function hasOwnScopeOnly(a: PiiActor): boolean {
  return !has(a, Permission.DATA_SCOPE_ALL) && !has(a, Permission.DATA_SCOPE_SUBTREE) && !has(a, Permission.DATA_SCOPE_BRANCH);
}

/**
 * D-3 de F4: en las pantallas de trabajo (Agenda, Mora, Rutas) ¿el documento va en claro sin que lo pida? Sí para quien tiene
 * `client:pii:read` (administrador, gerente, auditor) y para quien sólo tiene alcance propio (el cobrador, sobre su cartera). El
 * supervisor lo ve enmascarado y lo revela con la acción explícita.
 */
export function documentInClearByDefault(a: PiiActor): boolean {
  if (!canReveal(a)) return false;
  return has(a, Permission.CLIENT_PII_READ) || hasOwnScopeOnly(a);
}

/** Categorías que esta persona puede ver completas (DOCUMENT = puede revelar el documento). */
export function visiblePiiCategories(a: PiiActor): PiiCategory[] {
  const out: PiiCategory[] = [];
  if (canReveal(a)) out.push(PiiCategory.DOCUMENT);
  if (canSeeContact(a)) out.push(PiiCategory.CONTACT);
  if (canSeeEconomic(a)) out.push(PiiCategory.ECONOMIC);
  return out;
}
