import type { MoraPromise } from '../types/mora.types.js';
import { summarizePromises, type PromiseSummary } from './promises.js';

/**
 * Las métricas de recuperación de un crédito: **qué se hizo, qué se logró y cuánto tardó**, calculadas una sola
 * vez para que el panel y el móvil digan lo mismo (la regla de negocio no se repite en cada cliente).
 *
 * 🔴 **Se miden sobre la mora actual, no sobre toda la vida del crédito.** Un contacto de hace un año no es «el
 * primer contacto» de esta mora. Por eso los eventos se cuentan desde que **empezó el episodio** (`since`); sin un
 * episodio abierto (el crédito no está en mora) se muestra el histórico y no se calculan «días hasta…», que no
 * tienen de dónde contar.
 *
 * 🔴 **Los «días hasta…» son `undefined` cuando todavía no pasó** (no hubo contacto, ni visita, ni pago): sin eso
 * habría que mostrar 0 días, que diría «lo contactamos el primer día». Y si el inicio de la mora es estimado
 * (`sinceEstimated`), la pantalla lo dice: un importado sólo trae días, y empezar = corte − días es una cuenta.
 */

/** Resultados que significan «se habló con el deudor». Una llamada que no respondió o un número equivocado, no. */
export const CONTACT_RESULTS = ['CONTACTED', 'PROMISE_TO_PAY', 'REFUSAL', 'PARTIAL_PAYMENT', 'PAID'] as const;

/**
 * Cuántos días de diferencia entre «empezó la mora» y «Kobrax empezó a registrarla» son normales. El trabajo
 * diario detecta una mora nueva al día siguiente; más que eso, la mora ya venía de antes.
 */
export const TRACKING_GRACE_DAYS = 3;

export interface MetricActivity {
  type: string;
  result?: string | null;
  createdAt: string | Date;
}

export interface MetricPayment {
  amount: number;
  paymentDate: string | Date;
  /** Default `KOBRAX_COLLECTED`. Lo confirmado por un canal de la entidad no es plata que Kobrax cobró. */
  channel?: string | null;
}

export interface RecoveryMetricsInput {
  /** El instante de «ahora». */
  now: string | Date;
  /** La mora abierta, si el crédito está en mora. Sin ella no hay desde cuándo contar. */
  episode?: {
    startedAt: string;
    startedAtEstimated: boolean;
    balanceAtStart?: number;
    /** `YYYY-MM-DD` desde que Kobrax registra esta mora (cuando se abrió el episodio). */
    trackedSince?: string;
  };
  /** Cuánto tardó la última mora que **terminó recuperada** (pagó o se puso al día), si hubo. */
  lastRecoveredDays?: number;
  activities: readonly MetricActivity[];
  payments: readonly MetricPayment[];
  promises: readonly MoraPromise[];
}

export interface RecoveryMetrics {
  /** `EPISODE`: desde que empezó la mora actual. `ALL`: histórico (el crédito no está en mora). */
  window: 'EPISODE' | 'ALL';
  /** `YYYY-MM-DD` de inicio de la mora actual. Sólo con `EPISODE`. */
  since?: string;
  sinceEstimated?: boolean;
  /** Saldo con el que entró a esta mora. Ausente = no se midió. */
  balanceAtStart?: number;
  /**
   * 🔴 Cuántos días llevaba ya la mora cuando Kobrax empezó a registrarla. Lo anterior pudo ocurrir **fuera del
   * sistema** (un crédito importado que ya venía vencido hace un año): «395 días hasta el primer contacto» sería
   * cierto en el papel y engañoso. Ausente = la mora se registró desde el principio (o no se sabe).
   */
  untrackedDays?: number;
  /**
   * Los mismos hitos pero contados **desde que Kobrax registra la mora** y no desde que empezó: lo que mide la
   * rapidez del equipo cuando la cartera ya venía vencida. Sólo cuando `untrackedDays` está presente; si la mora se
   * registró desde el principio, los dos números coinciden y no hace falta repetirlo.
   */
  sinceTracking?: { daysToFirstContact?: number; daysToFirstVisit?: number; daysToFirstPayment?: number };
  /** Plata cobrada por Kobrax dentro de la ventana, y cuántos pagos fueron. */
  recoveredAmount: number;
  paymentsCount: number;
  /** Lo mismo pero de toda la vida del crédito. */
  recoveredAllTime: number;
  /** Gestiones de cobranza: llamadas, visitas y mensajes. Las notas no cuentan como gestión. */
  activities: { total: number; calls: number; visits: number; messages: number };
  notes: number;
  /** Cuántas gestiones llegaron a hablar con el deudor. */
  contacts: number;
  /** Días desde el inicio de la mora hasta el primer evento. `undefined` = todavía no pasó (o no hay desde cuándo contar). */
  daysToFirstContact?: number;
  daysToFirstVisit?: number;
  daysToFirstPayment?: number;
  promises: PromiseSummary;
  /** Cuánto tardó la última mora recuperada. */
  lastRecoveredDays?: number;
}

const DAY_MS = 86_400_000;
const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));
/** Medianoche UTC del día de un instante (los días civiles de la base están en UTC). */
const utcDay = (v: string | Date): number => {
  const d = toDate(v);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const isKobraxCollected = (p: MetricPayment): boolean => (p.channel ?? 'KOBRAX_COLLECTED') === 'KOBRAX_COLLECTED';
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeRecoveryMetrics(input: RecoveryMetricsInput): RecoveryMetrics {
  const start = input.episode ? Date.parse(`${input.episode.startedAt}T00:00:00Z`) : undefined;
  const inWindow = (at: string | Date): boolean => start === undefined || utcDay(at) >= start;
  const daysFrom = (at: string | Date): number | undefined =>
    start === undefined ? undefined : Math.max(0, Math.round((utcDay(at) - start) / DAY_MS));
  const earliest = (dates: (string | Date)[]): string | Date | undefined =>
    dates.sort((a, b) => toDate(a).getTime() - toDate(b).getTime())[0];

  const acts = input.activities.filter((a) => inWindow(a.createdAt));
  const count = (type: string): number => acts.filter((a) => a.type === type).length;
  const calls = count('CALL');
  const visits = count('VISIT');
  const messages = count('MESSAGE');
  const contactActs = acts.filter((a) => a.type !== 'NOTE' && (CONTACT_RESULTS as readonly string[]).includes(a.result ?? ''));

  const collected = input.payments.filter(isKobraxCollected);
  const windowPayments = collected.filter((p) => inWindow(p.paymentDate));

  const firstContact = earliest(contactActs.map((a) => a.createdAt));
  const firstVisit = earliest(acts.filter((a) => a.type === 'VISIT').map((a) => a.createdAt));
  const firstPayment = earliest(windowPayments.map((p) => p.paymentDate));

  // Una promesa pertenece a la mora en que se hizo: se mira cuándo se creó, no la fecha prometida.
  const promises = input.promises.filter((p) => inWindow(p.createdAt));

  const tracked = input.episode?.trackedSince ? Date.parse(`${input.episode.trackedSince}T00:00:00Z`) : undefined;
  const untracked = tracked !== undefined && start !== undefined ? Math.round((tracked - start) / DAY_MS) : undefined;

  const untrackedDays = untracked !== undefined && untracked > TRACKING_GRACE_DAYS ? untracked : undefined;
  const daysFromTracking = (at: string | Date | undefined): number | undefined =>
    at === undefined || tracked === undefined ? undefined : Math.max(0, Math.round((utcDay(at) - tracked) / DAY_MS));

  return {
    window: input.episode ? 'EPISODE' : 'ALL',
    since: input.episode?.startedAt,
    sinceEstimated: input.episode?.startedAtEstimated,
    balanceAtStart: input.episode?.balanceAtStart,
    untrackedDays,
    sinceTracking:
      untrackedDays === undefined
        ? undefined
        : {
            daysToFirstContact: daysFromTracking(firstContact),
            daysToFirstVisit: daysFromTracking(firstVisit),
            daysToFirstPayment: daysFromTracking(firstPayment),
          },
    recoveredAmount: round2(windowPayments.reduce((s, p) => s + p.amount, 0)),
    paymentsCount: windowPayments.length,
    recoveredAllTime: round2(collected.reduce((s, p) => s + p.amount, 0)),
    activities: { total: calls + visits + messages, calls, visits, messages },
    notes: count('NOTE'),
    contacts: contactActs.length,
    daysToFirstContact: firstContact === undefined ? undefined : daysFrom(firstContact),
    daysToFirstVisit: firstVisit === undefined ? undefined : daysFrom(firstVisit),
    daysToFirstPayment: firstPayment === undefined ? undefined : daysFrom(firstPayment),
    promises: summarizePromises(promises),
    lastRecoveredDays: input.lastRecoveredDays,
  };
}
