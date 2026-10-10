/**
 * Lo que la ficha de mora muestra de un crédito, **ya masticado**: historial de episodios, métricas de recuperación,
 * pagos, notas, aviso de la fuente (PSF), datos del resumen y validación de la gestión. Puro: sin red ni React, para
 * probarlo solo. Las palabras y los colores son los del panel (`apps/web/.../mora/[creditId]`): el cobrador y la
 * supervisora tienen que leer lo mismo.
 *
 * 🔴 Aquí NO se calcula nada de negocio: la mora, la categoría, la prioridad, las métricas y el estado de cada
 * promesa los calcula el servidor (`packages/shared` + API). Esto sólo formatea.
 *
 * 🔴 **Ausente ≠ cero.** Un dato que nadie midió es «—», nunca 0.
 */
import {
  memberName,
  MORA_NOTE_MAX_LENGTH,
  PROMISE_RESULT,
  validateRecoveryActivity,
  type CreditNote,
  type MoraCategoryTag,
  type MoraCreditDetail,
  type MoraEpisode,
  type MoraEpisodeEndReason,
  type MoraNoteColor,
  type MoraPromise,
  type PaymentItem,
  type RecoveryActivityError,
  type RecoveryActivityInput,
  type RecoveryMetrics,
} from '@kobrax/shared';
import type { ArrearsSource, ExternalSyncStatus } from '@kobrax/shared';
import { money } from './agenda-form';
import type { LookTone } from './mora';
import type { BadgeTone } from './ui';

const DASH = '—';

/** `YYYY-MM-DD` (o ISO) → `dd/mm/yyyy`, leído como texto: son días civiles, no instantes (sin corrimiento de zona). */
export function dayText(iso: string | undefined): string {
  if (!iso || iso.length < 10) return DASH;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** `YYYY-MM-DD` → `dd/mm` (como dice el reporte PSF: «del 03/10»). */
export function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** «1 día» / «12 días». */
export function daysText(n: number): string {
  return `${n} ${n === 1 ? 'día' : 'días'}`;
}

/** El día civil de hoy **del teléfono** (`YYYY-MM-DD`): con el UTC, a las 21:00 en Bolivia «hoy» ya sería mañana. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// ── Historial de mora (episodios) ───────────────────────────────────────────────────────────────────────────

/**
 * Cómo terminó una mora. 🔴 **Ausente de la fuente es ámbar, no verde**: no se sabe si pagó, y pintarlo como una
 * recuperación sería afirmar algo que nadie sabe.
 */
export const END_REASON_META: Record<MoraEpisodeEndReason, { label: string; tone: BadgeTone; hint?: string }> = {
  PAID: { label: 'Saldó la deuda', tone: 'success' },
  CURRENT: { label: 'Se puso al día', tone: 'success' },
  SOURCE_ABSENT: {
    label: 'Dejó de venir en el reporte',
    tone: 'warning',
    hint: 'La fuente dejó de reportarlo: no se sabe si pagó o se puso al día.',
  },
  WRITTEN_OFF: { label: 'Castigado', tone: 'danger' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
  DELETED: { label: 'Eliminado', tone: 'neutral' },
};

/** De dónde salen los días de mora. */
export const ARREARS_SOURCE_LABEL: Record<ArrearsSource, string> = {
  CALCULATED: 'Calculada',
  IMPORTED: 'Del archivo',
  MANUAL: 'A mano',
};

export interface EpisodeView {
  id: string;
  title: string;
  /** «Actual», o cómo terminó. Ausente = un episodio cerrado sin motivo conocido. */
  badge?: { label: string; tone: BadgeTone };
  /** Una nota corta bajo el título (por ejemplo, qué quiere decir «dejó de venir en el reporte»). */
  hint?: string;
  reconstructed: boolean;
  /** `29/09/2026 (aprox.) → en curso`. */
  range: string;
  source: string;
  items: { label: string; value: string }[];
}

/**
 * Un episodio listo para pintar. Los opcionales ausentes quedan «—»; el saldo al salir de una mora que sigue abierta
 * también es «—» (todavía no salió). `(aprox.)` marca un inicio que es una cuenta (corte menos días), no una fecha declarada.
 */
export function episodeView(e: MoraEpisode, currency: string): EpisodeView {
  const amount = (n: number | undefined) => (n === undefined ? DASH : money(n, currency));
  const days = (n: number | undefined) => (n === undefined ? DASH : daysText(n));
  const end = e.endReason ? END_REASON_META[e.endReason] : undefined;
  return {
    id: e.id,
    title: `Mora #${e.number}`,
    badge: e.current ? { label: 'Actual', tone: 'info' } : end ? { label: end.label, tone: end.tone } : undefined,
    hint: e.current ? undefined : end?.hint,
    reconstructed: e.reconstructed,
    range: `${dayText(e.startedAt)}${e.startedAtEstimated ? ' (aprox.)' : ''} → ${e.endedAt ? dayText(e.endedAt) : 'en curso'}`,
    source: ARREARS_SOURCE_LABEL[e.source] ?? e.source,
    items: [
      { label: 'Duración', value: daysText(e.durationDays) },
      { label: 'Pico de mora', value: days(e.maxDaysPastDue) },
      { label: 'Saldo al entrar', value: amount(e.balanceAtStart) },
      { label: 'Saldo al salir', value: e.current ? DASH : amount(e.balanceAtEnd) },
      { label: 'Entró con', value: days(e.startDaysPastDue) },
    ],
  };
}

// ── Métricas de recuperación ────────────────────────────────────────────────────────────────────────────────

export interface MetricCard {
  label: string;
  value: string;
  hint?: string;
}

export interface MetricsView {
  /** «Desde que empezó esta mora, el 29/09/2026.» o «Histórico del crédito: ahora no está en mora.» */
  intro: string;
  /** Aviso de que la mora ya venía de antes de registrarse. */
  untracked?: string;
  cards: MetricCard[];
}

/**
 * Las mismas cifras que el panel, en el mismo orden y con las mismas palabras.
 * 🔴 Lo que todavía no pasó se dice («Todavía sin contacto»), no se muestra como 0 días. Un 0 de verdad (el mismo
 * día del inicio) sí: «El mismo día». El cumplimiento de promesas sólo cuenta las cerradas (regla de `summarizePromises`).
 */
export function metricsView(m: RecoveryMetrics, currency: string): MetricsView {
  const amount = (n: number) => money(n, currency);
  const episode = m.window === 'EPISODE';
  const after = (n: number) => `A los ${daysText(n)}`;
  /** «el mismo día» / «a los 4 días» / el texto de «todavía no». */
  const days = (n: number | undefined, pending: string) => (n === undefined ? pending : n === 0 ? 'El mismo día' : after(n));
  const tracked = (n: number | undefined) =>
    n === undefined ? undefined : `Desde que Kobrax lo gestiona: ${(n === 0 ? 'El mismo día' : after(n)).toLowerCase()}`;
  const p = m.promises;
  const closed = p.kept + p.broken;
  const estimated = episode && m.sinceEstimated ? ' (inicio aproximado)' : '';

  const cards: MetricCard[] = [
    {
      label: 'Recuperado',
      value: amount(m.recoveredAmount),
      hint: [m.paymentsCount === 0 ? 'Sin pagos' : m.paymentsCount === 1 ? '1 pago' : `${m.paymentsCount} pagos`, m.balanceAtStart !== undefined ? `de ${amount(m.balanceAtStart)} al entrar` : null]
        .filter(Boolean)
        .join(' · '),
    },
    {
      label: 'Gestiones',
      value: String(m.activities.total),
      hint: `${m.activities.calls} ${m.activities.calls === 1 ? 'llamada' : 'llamadas'} · ${m.activities.visits} ${m.activities.visits === 1 ? 'visita' : 'visitas'} · ${m.activities.messages} ${m.activities.messages === 1 ? 'mensaje' : 'mensajes'}`,
    },
    { label: 'Llegó a hablar con el deudor', value: String(m.contacts), hint: m.contacts === 1 ? 'vez' : 'veces' },
    { label: 'Primera visita', value: days(m.daysToFirstVisit, episode ? 'Todavía sin visita' : DASH), hint: tracked(m.sinceTracking?.daysToFirstVisit) },
    { label: 'Primer pago', value: days(m.daysToFirstPayment, episode ? 'Todavía sin pagos' : DASH), hint: tracked(m.sinceTracking?.daysToFirstPayment) },
    { label: 'Primer contacto', value: days(m.daysToFirstContact, episode ? 'Todavía sin contacto' : DASH), hint: tracked(m.sinceTracking?.daysToFirstContact) },
    {
      label: 'Promesas cumplidas',
      value: closed === 0 ? DASH : `${p.kept} de ${closed}`,
      hint: [
        p.complianceRate === undefined ? 'Todavía no hay promesas cerradas' : `Cumplimiento ${Math.round(p.complianceRate * 100)} %`,
        p.active > 0 ? `${p.active} ${p.active === 1 ? 'vigente' : 'vigentes'}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
  ];
  if (m.lastRecoveredDays !== undefined) cards.push({ label: 'Última mora recuperada en', value: after(m.lastRecoveredDays) });
  if (episode && m.recoveredAllTime !== m.recoveredAmount) cards.push({ label: 'Recuperado en toda la vida del crédito', value: amount(m.recoveredAllTime) });

  return {
    intro: episode ? `Desde que empezó esta mora, el ${dayText(m.since)}.${estimated}` : 'Histórico del crédito: ahora no está en mora.',
    untracked:
      m.untrackedDays === undefined
        ? undefined
        : `Esta mora ya llevaba ${daysText(m.untrackedDays)} cuando se empezó a registrar en Kobrax: lo que se hizo antes puede no estar cargado, y los días hasta el primer contacto, visita o pago cuentan desde el inicio de la mora.`,
    cards,
  };
}

// ── Pagos ───────────────────────────────────────────────────────────────────────────────────────────────────

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  QR: 'QR',
  CARD: 'Tarjeta',
  MOBILE_PAYMENT: 'Pago móvil',
};

/** El icono y el color de cada medio de pago (`METHOD_LOOK` del panel): se reconoce de un vistazo cómo pagó. */
export const METHOD_LOOK: Record<string, { tone: LookTone; icon: string }> = {
  CASH: { tone: 'green', icon: '💵' },
  MOBILE_PAYMENT: { tone: 'blue', icon: '📱' },
  TRANSFER: { tone: 'purple', icon: '🔁' },
  QR: { tone: 'amber', icon: '▦' },
  CARD: { tone: 'teal', icon: '💳' },
};

export const CHANNEL_LABEL: Record<string, string> = {
  KOBRAX_COLLECTED: 'La cobró Kobrax',
  EXTERNAL_CONFIRMED: 'Pagó por un canal de la entidad',
};

const isKobrax = (p: Pick<PaymentItem, 'channel'>) => (p.channel ?? 'KOBRAX_COLLECTED') === 'KOBRAX_COLLECTED';

/** Lo cobrado por Kobrax: lo confirmado por un canal de la entidad no es plata que Kobrax cobró. */
export function collectedTotal(payments: readonly Pick<PaymentItem, 'amount' | 'channel'>[]): number {
  return payments.filter(isKobrax).reduce((s, p) => s + p.amount, 0);
}

export function paymentsSummary(payments: readonly Pick<PaymentItem, 'amount' | 'channel'>[], currency: string): string {
  const n = payments.length;
  return `${n === 1 ? '1 pago' : `${n} pagos`} · Cobrado por Kobrax: ${money(collectedTotal(payments), currency)}`;
}

export interface PaymentView {
  id: string;
  amount: string;
  method: string;
  look: { tone: LookTone; icon: string };
  /** Sólo el pago confirmado por la entidad lleva etiqueta de canal: «Kobrax» es lo de siempre. */
  channel?: string;
  receipt?: string;
  by?: string;
  notes?: string;
  /** `dd/mm/yyyy`. */
  date: string;
}

export function paymentView(p: PaymentItem, currency: string, nameOf: NameOf): PaymentView {
  return {
    id: p.id,
    amount: money(p.amount, currency),
    method: METHOD_LABEL[p.method] ?? p.method,
    look: METHOD_LOOK[p.method] ?? METHOD_LOOK.CASH!,
    channel: p.channel === 'EXTERNAL_CONFIRMED' ? 'Canal de la entidad' : undefined,
    receipt: p.receiptNumber !== undefined ? `Comprobante Nº ${p.receiptNumber}` : undefined,
    by: p.registeredBy ? `Registró ${nameOf(p.registeredBy, p.registeredByName)}` : undefined,
    notes: p.notes,
    date: dayText((p.paymentDate ?? p.createdAt).slice(0, 10)),
  };
}

// ── Notas ───────────────────────────────────────────────────────────────────────────────────────────────────

/** La paleta del post-it (la misma del panel): fondo, encabezado y tinta. El tipo de nota es otra cosa. */
export const NOTE_COLORS: Record<MoraNoteColor, { bg: string; head: string; ink: string }> = {
  YELLOW: { bg: '#fef9c3', head: '#fdef8a', ink: '#854d0e' },
  PINK: { bg: '#fce7f3', head: '#fbcfe8', ink: '#9d174d' },
  BLUE: { bg: '#dbeafe', head: '#bfdbfe', ink: '#1e40af' },
  GREEN: { bg: '#dcfce7', head: '#bbf7d0', ink: '#166534' },
  PURPLE: { bg: '#ede9fe', head: '#ddd6fe', ink: '#5b21b6' },
  ORANGE: { bg: '#ffedd5', head: '#fed7aa', ink: '#9a3412' },
};

export const NOTE_COLOR_LABEL: Record<MoraNoteColor, string> = {
  YELLOW: 'Amarillo',
  PINK: 'Rosa',
  BLUE: 'Azul',
  GREEN: 'Verde',
  PURPLE: 'Violeta',
  ORANGE: 'Naranja',
};

/** El color del punto de cada tipo de nota: lo importante se ve antes de leerlo. */
export const NOTE_KIND_TONE: Record<CreditNote['kind'], BadgeTone> = { INFO: 'neutral', WARNING: 'warning', IMPORTANT: 'danger' };

/**
 * ¿Puede esta persona cambiar el **texto** (o el tipo) y borrar esta nota? Es la regla de la API (`canEditNote`):
 * quien la escribió, o quien reparte cartera (`assignment:write`). Acá sólo decide qué botones se ofrecen; la API la
 * vuelve a exigir.
 */
export function canEditNoteText(note: Pick<CreditNote, 'authorId'>, userId: string | undefined, canAssign: boolean): boolean {
  return canAssign || (!!userId && note.authorId === userId);
}

/** Lo más importante arriba; a igual tipo, lo más reciente primero (como el panel). */
export function sortNotes(notes: readonly CreditNote[]): CreditNote[] {
  const rank = { IMPORTANT: 0, WARNING: 1, INFO: 2 } as const;
  return [...notes].sort((a, b) => rank[a.kind] - rank[b.kind] || b.createdAt.localeCompare(a.createdAt));
}

/** Largo válido de una nota (el contrato compartido; la API y la base lo vuelven a validar). */
export function noteBodyValid(body: string): boolean {
  const t = body.trim();
  return t.length > 0 && t.length <= MORA_NOTE_MAX_LENGTH;
}

// ── Nombres ─────────────────────────────────────────────────────────────────────────────────────────────────

/** «Quién» de una persona: su id y el nombre que mandó el servidor (`authorName`, `registeredByName`…), si lo mandó. */
export type NameOf = (id?: string, name?: string) => string;

/**
 * «Quién» de una persona. 🔴 **El nombre lo manda el servidor** (`authorName`, `assigneeName`, `registeredByName`…): un
 * cobrador no puede leer `GET /users`, así que el teléfono ya no pide el equipo. Sólo cuando el campo falta (datos
 * guardados antes de que la API los mandara) se cae al respaldo: «Yo» si es el que mira, el nombre del equipo si se
 * pasó una lista, y si no «alguien del equipo» (no se inventa un nombre).
 */
export function nameResolver(
  members: readonly { userId: string; firstName: string | null; lastName: string | null; email: string }[] = [],
  myId?: string,
  fallback = 'alguien del equipo',
): NameOf {
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));
  return (id, name) => (name ? name : !id ? fallback : id === myId ? 'Yo' : (byId.get(id) ?? fallback));
}

// ── Aviso de la fuente externa (PSF) ────────────────────────────────────────────────────────────────────────

/**
 * El aviso de la fuente externa (F4/08 · D9). 🔴 **Ausente no es pagado**: si ya no aparece en el reporte se dice
 * exactamente eso y que pudo ponerse al día o cancelarse —el reporte no dice cuál—. Nunca «pagado». Un dato viejo se
 * avisa aparte, con la fecha de corte. Ninguno bloquea el trabajo de campo.
 */
export function psfNotice(d: {
  externalSource?: string;
  syncStatus?: ExternalSyncStatus;
  absentSince?: string;
  reportedAsOf?: string;
  reportedStale?: boolean;
}): string | undefined {
  if (!d.externalSource) return undefined;
  if (d.syncStatus === 'ABSENT') {
    const when = d.absentSince ?? d.reportedAsOf;
    return when
      ? `Ya no aparece en el reporte del ${ddmm(when)}. Puede haberse puesto al día o cancelado; el reporte no lo dice.`
      : 'Ya no aparece en el reporte. Puede haberse puesto al día o cancelado; el reporte no lo dice.';
  }
  if (d.reportedStale) return `Dato desactualizado${d.reportedAsOf ? ` · ${d.externalSource} · al ${ddmm(d.reportedAsOf)}` : ''}`;
  return undefined;
}

/** La insignia de la fuente: la externa tal cual (PSF) o Kobrax. */
export function sourceBadge(externalSource?: string): string {
  return externalSource ?? 'Kobrax';
}

// ── Resumen de la ficha ─────────────────────────────────────────────────────────────────────────────────────

/** Cuánto del capital original ya no se debe, de 0 a 100. Sin los dos números no hay porcentaje: se dice, no se inventa. */
export function paidPercent(principal: number | undefined, balance: number | undefined): number | undefined {
  if (principal === undefined || balance === undefined || principal <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round(((principal - balance) / principal) * 100)));
}

/**
 * «Categoría B · 47 días de mora». La categoría llega de la API y se muestra tal cual: nunca se calcula acá. Castigado
 * va **además** (condición aparte) y, como en el panel, pone los días antes que la categoría.
 */
export function situationDetail(d: { situation: string; daysPastDue: number; category?: MoraCategoryTag; writtenOff: boolean }): string {
  const parts: string[] = [];
  const inArrears = d.situation === 'IN_ARREARS';
  if (inArrears || (d.writtenOff && d.daysPastDue > 0)) {
    if (!d.writtenOff && d.category) parts.push(`Categoría ${d.category.code}`);
    if (d.daysPastDue > 0) parts.push(`${daysText(d.daysPastDue)} de mora`);
    if (d.writtenOff && d.category) parts.push(`Categoría ${d.category.code}`);
  }
  return parts.join(' · ');
}

/** «Última gestión»: un dato suelto, no un estado. «hoy · Llamada · No respondió». */
export function lastActionText(
  d: { lastActionAt?: string; lastActivityType?: string; lastActivityResult?: string },
  label: (a: { type: string; result?: string }) => string,
  asOf: Date = new Date(),
): string {
  if (!d.lastActionAt) return 'Sin gestiones';
  const days = Math.max(0, Math.floor((asOf.getTime() - new Date(d.lastActionAt).getTime()) / 86_400_000));
  const when = days === 0 ? 'hoy' : `hace ${daysText(days)}`;
  return d.lastActivityType ? `${when} · ${label({ type: d.lastActivityType, result: d.lastActivityResult })}` : when;
}

/** «Promesa vigente»: un dato suelto («Bs 300 · 10/10»), la próxima por fecha; «Ninguna» si no hay. */
export function activePromiseText(promises: readonly MoraPromise[], currency: string): string {
  const next = promises.filter((p) => p.status === 'ACTIVE').sort((a, b) => a.promiseDate.localeCompare(b.promiseDate))[0];
  if (!next) return 'Ninguna';
  return `${next.amount === undefined ? 'Sin monto' : money(next.amount, currency)} · ${ddmm(next.promiseDate)}`;
}

/** «Inicio de la mora»: lo declarado, o el inicio del episodio abierto (aproximado si es una cuenta). */
export function moraSinceText(detail: Pick<MoraCreditDetail, 'moraSince'>, episodes: readonly MoraEpisode[]): string {
  if (detail.moraSince) return dayText(detail.moraSince);
  const open = episodes.find((e) => e.current);
  return open ? `${dayText(open.startedAt)}${open.startedAtEstimated ? ' (aprox.)' : ''}` : DASH;
}

// ── Registrar gestión: validación ───────────────────────────────────────────────────────────────────────────

/** Por qué una gestión no es válida, en las palabras del panel (`panel.mora.ficha.activity.errors`). */
export const ACTIVITY_ERROR_TEXT: Record<RecoveryActivityError, string> = {
  TYPE_INVALID: 'Ese tipo de gestión no se registra a mano.',
  NOTES_REQUIRED: 'Escribí la nota.',
  NOTES_TOO_LONG: 'La observación es demasiado larga.',
  RESULT_REQUIRED: 'Elegí cómo terminó la gestión.',
  RESULT_NOT_ALLOWED: 'Ese resultado no corresponde a este tipo de gestión.',
  PROMISE_REQUIRED: 'Completá el monto, la fecha y el medio de pago de la promesa.',
  PROMISE_NOT_ALLOWED: 'Sólo una gestión con resultado «promesa de pago» lleva promesa.',
  PROMISE_AMOUNT_INVALID: 'El monto prometido tiene que ser mayor a cero.',
  PROMISE_DATE_INVALID: 'Elegí la fecha prometida.',
  PROMISE_DATE_PAST: 'La fecha prometida no puede ser anterior a hoy.',
  PROMISE_METHOD_REQUIRED: 'Elegí el medio de pago de la promesa.',
  // F4/13 · E4 — contexto de la gestión
  REASON_INVALID: 'El motivo de no pago no es válido.',
  CONTEXT_NOT_ALLOWED: 'Una nota no lleva motivo ni datos de quién responde.',
  EXPECTED_INCOME_DATE_INVALID: 'La fecha en que espera cobrar no es válida.',
  EXPECTED_INCOME_DATE_PAST: 'La fecha en que espera cobrar no puede ser anterior a hoy.',
  EXPECTED_INCOME_DATE_NEEDS_REASON: 'Elegí el motivo antes de indicar cuándo espera cobrar.',
  PAYER_INVALID: 'Quién responde por el crédito no es válido.',
  ORIGIN_INVALID: 'El origen de la gestión no es válido.',
  TEMPLATE_INVALID: 'La plantilla de mensaje no es válida.',
  TEMPLATE_NOT_ALLOWED: 'Solo un mensaje lleva plantilla.',
};

export const BANK_REQUIRED_TEXT = 'Elegí el banco: este medio de pago lo necesita.';

/**
 * Valida la gestión ANTES de encolarla, con la misma regla que la API y el panel (`validateRecoveryActivity`):
 * resultado que corresponde al tipo, promesa y resultado «promesa de pago» juntos, fecha no anterior a hoy.
 * Además, si el medio de pago de la promesa exige banco (`requiresBank` del catálogo) y no se eligió, se pide.
 * `null` = válida.
 */
export function gestionError(input: RecoveryActivityInput, today: string, opts: { bankRequired?: boolean } = {}): string | null {
  const code = validateRecoveryActivity(input, today);
  if (code) return ACTIVITY_ERROR_TEXT[code];
  if (input.result === PROMISE_RESULT && opts.bankRequired && !input.promise?.bankCode) return BANK_REQUIRED_TEXT;
  return null;
}
