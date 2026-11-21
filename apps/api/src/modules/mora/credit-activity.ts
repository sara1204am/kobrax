import type { CreditActivity, CreditActivityType, DataOrigin, PayerParty, PrismaClient } from '@prisma/client';
import { assignedToId, nameOf, type NameMap } from './mora-names';

/** El episodio de mora abierto del crédito, o `null` si está al día. El cliente nunca lo manda: lo resuelve el servidor. */
export async function openEpisodeId(tx: Pick<PrismaClient, 'creditArrearEpisode'>, creditId: string): Promise<string | null> {
  const open = await tx.creditArrearEpisode.findFirst({ where: { creditId, endedAt: null }, orderBy: { startedAt: 'desc' }, select: { id: true } });
  return open?.id ?? null;
}

/**
 * Deja una gestión en la bitácora del crédito (`credit_activities`), ligada al episodio abierto si lo hay, y
 * actualiza `credits.last_action_at`. Ese campo es **solo informativo** («Última gestión»): no decide estado,
 * SLA ni filtros (F4/08 · D2).
 */
export async function recordCreditActivity(
  tx: Pick<PrismaClient, 'creditArrearEpisode' | 'creditActivity' | 'credit'>,
  data: {
    /** Cuándo ocurrió, si no es ahora (una gestión cargada con fecha de un día anterior). Ausente = ahora. */
    at?: Date;
    id?: string;
    accountId: string;
    creditId: string;
    clientId: string;
    userId?: string;
    type: CreditActivityType;
    result?: string | null;
    notes?: string | null;
    /** F4/13 · E4 — contexto de la gestión (todo opcional). */
    reasonCode?: string | null;
    expectedIncomeDate?: string | null;
    payerParty?: PayerParty | null;
    origin?: DataOrigin | null;
    /** F4/13 · E5 — plantilla de mensaje elegida. */
    templateCode?: string | null;
    /** Visita: dirección visitada. Llamada/mensaje: teléfono o correo. Mensaje: canal. Todo opcional. */
    locationId?: string | null;
    contactId?: string | null;
    channel?: string | null;
  },
): Promise<CreditActivity> {
  // Con fecha propia, la gestión cuelga de la mora que cubría ESA fecha (o de ninguna), no de la de hoy.
  const episodeId = data.at ? await episodeIdAt(tx, data.creditId, data.at) : await openEpisodeId(tx, data.creditId);
  const activity = await tx.creditActivity.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      ...(data.at ? { createdAt: data.at } : {}),
      accountId: data.accountId,
      creditId: data.creditId,
      clientId: data.clientId,
      episodeId,
      userId: data.userId,
      type: data.type,
      result: data.result ?? null,
      notes: data.notes ?? null,
      reasonCode: data.reasonCode ?? null,
      // Un día civil, sin hora: `YYYY-MM-DD` → medianoche UTC, que una columna `DATE` guarda tal cual.
      expectedIncomeDate: data.expectedIncomeDate ? new Date(`${data.expectedIncomeDate}T00:00:00.000Z`) : null,
      payerParty: data.payerParty ?? null,
      origin: data.origin ?? null,
      templateCode: data.templateCode ?? null,
      locationId: data.locationId ?? null,
      contactId: data.contactId ?? null,
      channel: data.channel ?? null,
    },
  });
  // «Última gestión» no retrocede por cargar una gestión vieja: sólo avanza si la nueva es más reciente que la que ya había.
  if (data.at) {
    await tx.credit.updateMany({ where: { id: data.creditId, OR: [{ lastActionAt: null }, { lastActionAt: { lt: data.at } }] }, data: { lastActionAt: data.at } });
  } else {
    await tx.credit.update({ where: { id: data.creditId }, data: { lastActionAt: new Date() } });
  }
  return activity;
}

/** La mora que cubría ese día (empezó el día o antes y no había terminado), o `null` si el crédito estaba al día. */
async function episodeIdAt(tx: Pick<PrismaClient, 'creditArrearEpisode'>, creditId: string, at: Date): Promise<string | null> {
  const day = new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const found = await tx.creditArrearEpisode.findFirst({
    where: { creditId, startedAt: { lte: day }, OR: [{ endedAt: null }, { endedAt: { gte: day } }] },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  return found?.id ?? null;
}

/** Una gestión de la bitácora del crédito, como la ve el panel (mismos campos que la del caso, más el episodio). */
export function serializeCreditActivity(
  a: Pick<CreditActivity, 'id' | 'type' | 'result' | 'notes' | 'userId' | 'createdAt' | 'episodeId'> &
    Partial<Pick<CreditActivity, 'reasonCode' | 'expectedIncomeDate' | 'payerParty' | 'origin' | 'templateCode' | 'locationId' | 'contactId' | 'channel'>>,
  names?: NameMap,
) {
  // Una `ASSIGNMENT` guarda en la nota el id de a quién se asignó: se resuelve acá para que ningún cliente muestre un uuid.
  const assignedTo = a.type === 'ASSIGNMENT' ? assignedToId(a.notes) : undefined;
  return {
    id: a.id,
    type: a.type,
    result: a.result ?? undefined,
    notes: a.notes ?? undefined,
    userId: a.userId ?? undefined,
    authorName: nameOf(names, a.userId),
    assignedToId: assignedTo,
    assignedToName: nameOf(names, assignedTo),
    episodeId: a.episodeId ?? undefined,
    // F4/13 · E4: ausentes en lo anterior a estos campos.
    reasonCode: a.reasonCode ?? undefined,
    expectedIncomeDate: a.expectedIncomeDate ? a.expectedIncomeDate.toISOString().slice(0, 10) : undefined,
    payerParty: a.payerParty ?? undefined,
    origin: a.origin ?? undefined,
    templateCode: a.templateCode ?? undefined,
    locationId: a.locationId ?? undefined,
    contactId: a.contactId ?? undefined,
    channel: a.channel ?? undefined,
    createdAt: a.createdAt,
  };
}

/** Los ids de persona que una gestión necesita nombrar: quien la hizo y, si es una asignación, a quién. */
export function activityPeople(a: Pick<CreditActivity, 'type' | 'notes' | 'userId'>): (string | undefined)[] {
  return [a.userId ?? undefined, a.type === 'ASSIGNMENT' ? assignedToId(a.notes) : undefined];
}
