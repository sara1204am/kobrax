/**
 * Filas **provisionales** del caché para lo que se dio de alta sin señal.
 *
 * El cobrador crea un cliente (o un préstamo) parado en la puerta, el alta queda en la cola y... la app lo
 * ignoraba hasta que subiera: el cliente no salía en la búsqueda ni se podía abrir su ficha, y el préstamo no
 * aparecía en su contexto. Acá se escribe en el caché una fila marcada `pending: true` con lo que el teléfono
 * ya sabe; la próxima lectura con señal (`cachedOne` / hidratación) la reemplaza por la real, y al subir la cola
 * se le quita la marca (`confirmProvisionalRow`).
 *
 * Reglas (no romper los invariantes de `db.ts`):
 *  · **no cambia la forma de ninguna fila**: sólo suma el campo opcional `pending`. Por eso no sube
 *    `SCHEMA_VERSION` — los lectores viejos lo ignoran y el caché sigue siendo descartable;
 *  · usa las MISMAS claves (`client`, `client.context`) que las lecturas reales, así las pantallas no
 *    se enteran: leen su caché de siempre;
 *  · nunca pisa una fila real ya cacheada del mismo id: la provisional sólo ocupa un hueco.
 */
import type { NewClientInput, NewCreditInput } from '@kobrax/shared';
import * as db from '../db';
import { clientDisplayName } from '../clients.service';
import type { AgendaClientContext, ContactOption, CreditOption, LocationOption } from '../agenda.service';

type Pending<T> = T & { pending?: boolean };

/** Lo mínimo de `ClientDetail` que lee la ficha en su degradación «sin préstamos» y el buscador. */
interface ProvisionalClient {
  id: string;
  clientType: 'PERSON' | 'COMPANY';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId: string | null;
  status: 'ACTIVE';
  pending: true;
}

/** Escribe el cliente dado de alta offline en `client` y `client.context`. */
export async function writeProvisionalClient(input: NewClientInput): Promise<void> {
  const id = input.id;
  if (!id) return; // sin id no hay clave estable bajo la cual guardarlo

  if (!(await db.getOne('client', id))) {
    const row: ProvisionalClient = {
      id,
      clientType: input.clientType,
      firstName: input.firstName,
      lastName: input.lastName,
      businessName: input.businessName,
      nationalId: input.nationalId ?? null,
      status: 'ACTIVE',
      pending: true,
    };
    await db.putOne('client', id, row);
  }

  if (!(await db.getOne('client.context', id))) {
    const contacts: ContactOption[] = (input.contacts ?? []).map((c, i) => ({
      id: `pending-contact-${i}`,
      contactType: c.contactType,
      value: c.value,
      isPrimary: !!c.isPrimary,
    }));
    const locations: LocationOption[] = (input.locations ?? []).map((l, i) => ({
      id: `pending-location-${i}`,
      locationType: l.locationType ?? 'HOME',
      address: l.address ?? null,
      zone: l.zone,
      latitude: l.latitude,
      longitude: l.longitude,
    }));
    const ctx: Pending<AgendaClientContext> = {
      client: { id, displayName: clientDisplayName(input), nationalId: input.nationalId ?? null },
      credits: [],
      contacts,
      locations,
      pending: true,
    };
    await db.putOne('client.context', id, ctx);
  }
}

/** Suma el préstamo dado de alta offline al contexto de su cliente (si ese contexto está en el caché). */
export async function writeProvisionalCredit(input: NewCreditInput): Promise<void> {
  const id = input.id;
  if (!id) return;
  const ctx = await db.getOne<Pending<AgendaClientContext>>('client.context', input.clientId);
  if (!ctx || ctx.credits.some((c) => c.creditId === id)) return;
  const credit: Pending<CreditOption> = {
    creditId: id,
    // El caso lo abre el server al subir: hasta entonces no hay id de caso y las acciones que lo necesitan
    // (cobrar, registrar gestión) esperan a que el alta se confirme.
    caseId: '',
    principalAmount: input.principalAmount,
    outstandingBalance: input.outstandingBalance ?? input.principalAmount,
    overdueAmount: 0,
    currency: ctx.credits[0]?.currency ?? 'BOB',
    daysPastDue: input.daysPastDue ?? 0,
    pending: true,
  };
  await db.putOne('client.context', input.clientId, { ...ctx, credits: [...ctx.credits, credit] });
}

/**
 * El cobrador descartó un alta que el server rechazó: la fila provisional que la mostraba tiene que irse, o la
 * app seguiría ofreciendo un cliente (o préstamo) que no existe y que ya no va a subir.
 */
export async function dropProvisionalRow(kind: 'client' | 'credit', id: string, clientId?: string): Promise<void> {
  if (kind === 'client') {
    for (const k of ['client', 'client.context'] as const) {
      const row = await db.getOne<Pending<Record<string, unknown>>>(k, id);
      if (row?.pending) await db.removeOne(k, id);
    }
    return;
  }
  if (!clientId) return;
  const ctx = await db.getOne<Pending<AgendaClientContext>>('client.context', clientId);
  if (!ctx) return;
  const credits = ctx.credits.filter((c) => !(c.creditId === id && (c as Pending<CreditOption>).pending));
  if (credits.length !== ctx.credits.length) await db.putOne('client.context', clientId, { ...ctx, credits });
}

/** El alta subió: la fila deja de ser provisional (la hidratación la reemplaza por la real cuando pase). */
export async function confirmProvisionalRow(kind: 'client' | 'credit', id: string, clientId?: string): Promise<void> {
  if (kind === 'client') {
    for (const k of ['client', 'client.context'] as const) {
      const row = await db.getOne<Pending<Record<string, unknown>>>(k, id);
      if (row?.pending) {
        const { pending: _p, ...rest } = row;
        await db.putOne(k, id, rest);
      }
    }
    return;
  }
  if (!clientId) return;
  const ctx = await db.getOne<Pending<AgendaClientContext>>('client.context', clientId);
  if (!ctx) return;
  if (!ctx.credits.some((c) => c.creditId === id && (c as Pending<CreditOption>).pending)) return;
  const credits = ctx.credits.map((c) => {
    if (c.creditId !== id) return c;
    const { pending: _p, ...rest } = c as Pending<CreditOption>;
    return rest;
  });
  await db.putOne('client.context', clientId, { ...ctx, credits });
}
