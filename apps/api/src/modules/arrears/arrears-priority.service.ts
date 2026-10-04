import { Injectable } from '@nestjs/common';
import type { CollectionPriority, PrismaClient } from '@prisma/client';
import { computePriority, priorityParamsOf } from '../cases/case-priority';

/**
 * La prioridad vive en el **episodio de mora abierto** (F4/08 · D3): un crédito al día no tiene episodio abierto y
 * por tanto no tiene prioridad. El cálculo es el de siempre (`computePriority`: saldo + días de mora + segmento de
 * riesgo de la persona); lo único nuevo es dónde se guarda.
 *
 * Mientras `priority_pinned_at` esté puesta, el cálculo NO la pisa: la fijó una persona.
 */
@Injectable()
export class ArrearsPriorityService {
  /**
   * Recalcula la prioridad del episodio abierto del crédito. Devuelve la que quedó, o `null` si no hay episodio
   * abierto (crédito al día). Con la prioridad fijada a mano no escribe y devuelve la fijada.
   */
  async recomputeForCredit(tx: PrismaClient, creditId: string): Promise<CollectionPriority | null> {
    const episode = await tx.creditArrearEpisode.findFirst({
      where: { creditId, endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true, accountId: true, priority: true, priorityPinnedAt: true },
    });
    if (!episode) return null;
    if (episode.priorityPinnedAt) return episode.priority;

    const [credit, account] = await Promise.all([
      tx.credit.findFirst({
        where: { id: creditId, deletedAt: null },
        select: { outstandingBalance: true, daysPastDue: true, client: { select: { riskSegment: true } } },
      }),
      tx.account.findUnique({ where: { id: episode.accountId }, select: { configuration: true } }),
    ]);
    if (!credit) return null;

    const priority = computePriority(
      { outstandingBalance: Number(credit.outstandingBalance), daysPastDue: credit.daysPastDue, riskSegment: credit.client.riskSegment },
      priorityParamsOf(account?.configuration),
    );
    if (priority !== episode.priority) await tx.creditArrearEpisode.update({ where: { id: episode.id }, data: { priority } });
    return priority;
  }
}
