import type { CreditActivity, CreditActivityType, PrismaClient } from '@prisma/client';
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
  data: { id?: string; accountId: string; creditId: string; clientId: string; userId?: string; type: CreditActivityType; result?: string | null; notes?: string | null },
): Promise<CreditActivity> {
  const episodeId = await openEpisodeId(tx, data.creditId);
  const activity = await tx.creditActivity.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      accountId: data.accountId,
      creditId: data.creditId,
      clientId: data.clientId,
      episodeId,
      userId: data.userId,
      type: data.type,
      result: data.result ?? null,
      notes: data.notes ?? null,
    },
  });
  await tx.credit.update({ where: { id: data.creditId }, data: { lastActionAt: new Date() } });
  return activity;
}

/** Una gestión de la bitácora del crédito, como la ve el panel (mismos campos que la del caso, más el episodio). */
export function serializeCreditActivity(
  a: Pick<CreditActivity, 'id' | 'type' | 'result' | 'notes' | 'userId' | 'createdAt' | 'episodeId'>,
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
    createdAt: a.createdAt,
  };
}

/** Los ids de persona que una gestión necesita nombrar: quien la hizo y, si es una asignación, a quién. */
export function activityPeople(a: Pick<CreditActivity, 'type' | 'notes' | 'userId'>): (string | undefined)[] {
  return [a.userId ?? undefined, a.type === 'ASSIGNMENT' ? assignedToId(a.notes) : undefined];
}
