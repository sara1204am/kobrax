import type { PrismaClient } from '@prisma/client';
import { memberName } from '@kobrax/shared';

/** id de usuario → nombre para pintar. Sólo nombre y apellido: nunca correo ni teléfono. */
export type NameMap = ReadonlyMap<string, string>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * A quién se asignó la cobranza, según la nota de una gestión `ASSIGNMENT`: la nota trae el id pelado y las
 * filas viejas `Asignado a <uuid>`. Misma regla que `assignedTo` del panel.
 */
export function assignedToId(notes?: string | null): string | undefined {
  return notes?.match(UUID)?.[0] ?? undefined;
}

/** El nombre de un id, si se resolvió. */
export const nameOf = (names: NameMap | undefined, id?: string | null): string | undefined => (id ? names?.get(id) : undefined);

/**
 * Nombres de personas de **esta cuenta**, en UNA consulta (sin N+1). No exige `user:read`: el cobrador necesita
 * leer «registró Ana» sin poder listar al equipo, así que sólo sale el nombre, y sólo de quienes pertenecen a la
 * cuenta de la petición (un id de otra cuenta no se resuelve).
 *
 * 🔴 `memberName` cae al correo si el perfil viene vacío: acá se le pasa el correo vacío, así que sin nombre
 * no hay entrada (la pantalla dice «alguien del equipo») y el correo nunca sale.
 */
export async function loadNames(
  tx: Pick<PrismaClient, 'userAccount'>,
  accountId: string,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const rows = await tx.userAccount.findMany({
    where: { accountId, userId: { in: wanted } },
    select: { userId: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } },
  });
  for (const r of rows) {
    const name = memberName({ firstName: r.user.profile?.firstName ?? null, lastName: r.user.profile?.lastName ?? null, email: '' });
    if (name) out.set(r.userId, name);
  }
  return out;
}
