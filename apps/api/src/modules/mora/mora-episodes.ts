import type { MoraEpisode, MoraEpisodeEndReason } from '@kobrax/shared';

/** Lo que `MoraService` lee de `credit_arrear_episodes`. */
export interface EpisodeRow {
  id: string;
  startedAt: Date;
  startedAtEstimated: boolean;
  endedAt: Date | null;
  endReason: string | null;
  startDaysPastDue: number | null;
  maxDaysPastDue: number | null;
  balanceAtStart: unknown;
  balanceAtEnd: unknown;
  source: string;
  reconstructed: boolean;
  createdAt: Date;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;
const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const num = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));

/**
 * Los episodios de un crédito para la ficha: **del más reciente al más antiguo**, numerados en orden
 * cronológico (la «Mora #1» es la primera que tuvo, aunque se muestre al final).
 *
 * Los datos que nadie midió llegan ausentes. En un episodio reconstruido de un caso cerrado no hay días
 * máximos ni saldos, y un 0 diría «llegó a 0 días» de una mora que quizá llegó a 200.
 */
export function serializeEpisodes(rows: EpisodeRow[], now: Date = new Date()): MoraEpisode[] {
  const chrono = [...rows].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const today = utcDay(now);
  const out = chrono.map((e, i): MoraEpisode => {
    const end = e.endedAt ? utcDay(e.endedAt) : today;
    return {
      id: e.id,
      number: i + 1,
      startedAt: iso(e.startedAt),
      startedAtEstimated: e.startedAtEstimated,
      endedAt: e.endedAt ? iso(e.endedAt) : undefined,
      endReason: (e.endReason ?? undefined) as MoraEpisodeEndReason | undefined,
      startDaysPastDue: e.startDaysPastDue ?? undefined,
      maxDaysPastDue: e.maxDaysPastDue ?? undefined,
      balanceAtStart: num(e.balanceAtStart),
      balanceAtEnd: num(e.balanceAtEnd),
      source: e.source as MoraEpisode['source'],
      reconstructed: e.reconstructed,
      current: e.endedAt === null,
      durationDays: Math.max(0, Math.round((end - utcDay(e.startedAt)) / DAY_MS)),
    };
  });
  return out.reverse();
}
