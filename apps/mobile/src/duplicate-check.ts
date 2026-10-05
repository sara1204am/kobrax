/**
 * Duplicados al dar de alta un cliente (paridad con el panel web, F4/08 · fase 5).
 *
 * El servidor decide (`POST /clients/duplicate-check`: mismo documento BLOQUEA, mismo nombre AVISA).
 * Sin señal se contesta con lo que el teléfono ya tiene —la cartera bajada y las fichas cacheadas—,
 * y **se contesta ANTES de encolar el alta**: un alta offline que el servidor rechaza por documento
 * repetido fallaría después, sin que el cobrador esté mirando.
 *
 * Límite sin señal, a propósito: la cartera no trae el documento, así que el documento sólo se
 * compara contra clientes con ficha cacheada en claro (los dados de alta en este teléfono). Lo demás lo
 * vuelve a frenar el servidor al subir (`CLIENT_DUP`).
 */
import type { ClientDuplicateCheck, ClientDuplicateCheckInput, ClientDuplicateMatch, ClienteForm } from '@kobrax/shared';
import { apiMutate } from './api-client';
import { clientDisplayName, normalizar } from './clients.service';
import * as db from './db';

/**
 * Qué se le pregunta con lo escrito hasta ahora, o `null` si todavía no hay nada que valga la pena:
 * un documento de menos de 3 caracteres, o un nombre sin apellido (el servidor tampoco busca así).
 */
export function duplicateCheckInput(form: ClienteForm): ClientDuplicateCheckInput | null {
  const nationalId = form.nationalId.trim();
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  const businessName = form.businessName.trim();
  const docReady = nationalId.length >= 3;
  const nameReady = form.clientType === 'COMPANY' ? businessName.length >= 2 : firstName.length >= 2 && lastName.length >= 2;
  if (!docReady && !nameReady) return null;
  return form.clientType === 'COMPANY'
    ? { clientType: 'COMPANY', ...(docReady ? { nationalId } : {}), ...(nameReady ? { businessName } : {}) }
    : { clientType: 'PERSON', ...(docReady ? { nationalId } : {}), ...(nameReady ? { firstName, lastName } : {}) };
}

/** El nombre tal como se confirmó «es otra persona»: si cambia, la confirmación ya no vale. */
export function nameSignature(form: ClienteForm): string {
  const raw = form.clientType === 'COMPANY' ? form.businessName : `${form.firstName} ${form.lastName}`;
  return `${form.clientType}:${raw.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/** ¿Se puede guardar con este resultado? El documento bloquea; los homónimos, hasta que se confirme. */
export function duplicateBlocks(check: ClientDuplicateCheck | null, namesAccepted: boolean): 'document' | 'names' | null {
  if (!check) return null;
  if (check.document) return 'document';
  if (check.names.length > 0 && !namesAccepted) return 'names';
  return null;
}

/** `88****03`: lo justo para reconocerlo sin dejarlo a la vista. Lo ya enmascarado no se toca. */
export function maskDocument(doc: string | null | undefined): string | null {
  const d = (doc ?? '').trim();
  if (!d) return null;
  if (d.includes('*')) return d;
  if (d.length <= 4) return `${d.slice(0, 1)}${'*'.repeat(d.length - 1)}`;
  return `${d.slice(0, 2)}${'*'.repeat(Math.min(d.length - 4, 6))}${d.slice(-2)}`;
}

const docKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Sin tildes, mayúsculas ni orden de palabras (lo mismo que hace el servidor). */
const nameKey = (s: string) => normalizar(s).split(/\s+/).filter(Boolean).sort().join(' ');

interface LocalClient {
  id: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId?: string | null;
  status?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
}

/** Responde con lo que hay en el teléfono. Pura salvo por la lectura de la base local. */
export async function checkDuplicatesLocal(input: ClientDuplicateCheckInput): Promise<ClientDuplicateCheck> {
  const [portfolio, fichas] = await Promise.all([
    db.getMany<{ clientId?: string; clientName?: string }>('portfolio'),
    db.getMany<LocalClient>('client'),
  ]);
  const creditos = new Map<string, number>();
  const nombres = new Map<string, string>();
  for (const c of portfolio) {
    if (!c.clientId) continue;
    creditos.set(c.clientId, (creditos.get(c.clientId) ?? 0) + 1);
    if (c.clientName) nombres.set(c.clientId, c.clientName);
  }
  for (const f of fichas) nombres.set(f.id, clientDisplayName(f));

  const mine = input.clientType === 'COMPANY' ? input.businessName : `${input.firstName ?? ''} ${input.lastName ?? ''}`;
  const myKey = mine && mine.trim() ? nameKey(mine) : null;
  const myDoc = input.nationalId ? docKey(input.nationalId) : null;

  const match = (id: string, otherDocument: boolean, ficha?: LocalClient): ClientDuplicateMatch => ({
    id,
    displayName: nombres.get(id) ?? 'Sin nombre',
    maskedDocument: maskDocument(ficha?.nationalId),
    status: ficha?.status ?? 'ACTIVE',
    creditCount: creditos.get(id) ?? 0,
    deleted: false,
    otherDocument,
  });

  let document: ClientDuplicateMatch | null = null;
  if (myDoc) {
    // Un documento enmascarado (`88****03`) no se puede comparar: sólo cuentan las fichas en claro.
    const f = fichas.find((x) => x.nationalId && !x.nationalId.includes('*') && docKey(x.nationalId) === myDoc);
    if (f) document = match(f.id, false, f);
  }

  const names: ClientDuplicateMatch[] = [];
  if (myKey) {
    for (const [id, name] of nombres) {
      if (document?.id === id || nameKey(name) !== myKey) continue;
      const ficha = fichas.find((x) => x.id === id);
      const otherDocument = !!(myDoc && ficha?.nationalId && !ficha.nationalId.includes('*') && docKey(ficha.nationalId) !== myDoc);
      names.push(match(id, otherDocument, ficha));
    }
  }
  return { document, names };
}

export interface DuplicateAnswer {
  check: ClientDuplicateCheck;
  /** `local` = contestó el teléfono (sin señal): el servidor puede ver más. */
  source: 'server' | 'local';
}

/**
 * Pregunta por posibles duplicados. `null` = no se pudo saber (error del servidor, sesión vencida):
 * no se inventa nada y el alta sigue; el documento lo vuelve a frenar el servidor al guardar.
 */
export async function checkDuplicates(input: ClientDuplicateCheckInput): Promise<DuplicateAnswer | null> {
  const res = await apiMutate<ClientDuplicateCheck>('/clients/duplicate-check', 'POST', input);
  if (res.status === 'ok' && res.data && Array.isArray(res.data.names)) return { check: res.data, source: 'server' };
  if (res.status === 'offline') {
    try {
      return { check: await checkDuplicatesLocal(input), source: 'local' };
    } catch {
      return null;
    }
  }
  return null;
}
