import { CollectionPriority } from '@prisma/client';
import type { MoraCreditListItem } from '@kobrax/shared';
import { Report, arrearsTone, type TableColumn } from '../../common/pdf/report';
import { csvSafeText } from '../exports/csv';
import type { ListMoraQueryDto } from './dto/mora.dto';

import { AsyncResource } from 'node:async_hooks';

/**
 * Hace que cada paso de un iterable asíncrono corra **en el contexto de la petición que lo creó**.
 *
 * 🔴 Existe porque el tenant vive en un `AsyncLocalStorage`: Nest consume el stream **después** de que el
 * handler terminó, ya fuera de ese contexto, y el primer lote fallaba con «TenantContext no disponible»
 * cuando la cabecera del CSV ya había salido — un archivo que parece completo y no trae ni una fila. Atar el
 * contexto al crear el iterable (dentro del handler) es lo que lo evita.
 */
export function inRequestContext<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  const run = AsyncResource.bind(<R>(fn: () => R): R => fn());
  return {
    [Symbol.asyncIterator]() {
      const it = source[Symbol.asyncIterator]();
      return {
        next: () => run(() => it.next()),
        return: (value?: unknown) => run(() => (it.return ? it.return(value) : Promise.resolve({ done: true as const, value: undefined }))),
      };
    },
  };
}

/** Tope de filas por formato. Pasarlo se rechaza **antes** de escribir: un archivo cortado parece completo. */
export const MORA_CSV_MAX_ROWS = 50_000;
export const MORA_PDF_MAX_ROWS = 5_000;

const PRIORITY_LABEL: Record<string, string> = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' };
const SITUATION_LABEL: Record<string, string> = { CURRENT: 'Al día', IN_ARREARS: 'En mora' };
const ARREARS_LABEL: Record<string, string> = { CALCULATED: 'Calculada', IMPORTED: 'Del archivo', MANUAL: 'A mano' };
const ACTIVITY_LABEL: Record<string, string> = {
  NOTE: 'Nota',
  CALL: 'Llamada',
  VISIT: 'Visita',
  MESSAGE: 'Mensaje',
  PAYMENT: 'Pago',
  STATUS_CHANGE: 'Cambio de estado',
  ASSIGNMENT: 'Asignación',
};
const SORT_LABEL: Record<string, string> = {
  daysPastDue: 'días de mora',
  balance: 'saldo',
  priority: 'prioridad',
  createdAt: 'antigüedad',
};

const source = (c: MoraCreditListItem): string => c.externalSource ?? 'KOBRAX';
const day = (iso?: string): string => (iso ? iso.slice(0, 10) : '');

/** Nombres que el servicio resuelve aparte (el crédito sólo trae ids): responsable por id. */
export type MoraNames = Map<string, string>;

/**
 * Las columnas del CSV, en el orden en que se leen. Cabeceras en español y sin abreviar.
 *
 * 🔴 **Ausente queda en blanco, nunca 0**: un importado puede no traer la cuota o el vencido, y una celda
 * vacía dice «no se sabe» donde un 0 diría «no debe nada».
 *
 * 🔴 **Sin teléfonos, direcciones ni documento.** Es el listado de lo que se debe, no la agenda de los
 * deudores; y el export común de la cuenta ya cubre esos datos con su propio permiso y su auditoría.
 */
export const MORA_CSV_COLUMNS = [
  'Nº de crédito',
  'Deudor',
  'Moneda',
  'Saldo',
  'Monto original',
  'Cuota',
  'Próxima fecha',
  'Monto vencido',
  'Origen del monto vencido',
  'Último pago',
  'Días de mora',
  'Inicio de la mora',
  'Origen de la mora',
  'Fuente',
  'Corte del reporte',
  'Reporte desactualizado',
  'Estado en origen',
  'Situación',
  'Categoría',
  'Castigado',
  'Prioridad',
  'Responsable',
  'Oficina',
  'Última gestión',
  'Tipo de última gestión',
  'Resultado de última gestión',
  'Promesa vigente',
] as const;

const yesNo = (v: boolean | undefined): string => (v === undefined ? '' : v ? 'Sí' : 'No');

export function moraCsvRow(c: MoraCreditListItem, names: MoraNames): Record<string, unknown> {
  return {
    'Nº de crédito': csvSafeText(c.code ?? ''),
    Deudor: csvSafeText(c.clientName),
    Moneda: c.currency,
    Saldo: c.balance ?? '',
    'Monto original': c.principalAmount ?? '',
    Cuota: c.installmentAmount ?? '',
    'Próxima fecha': day(c.nextDueDate),
    'Monto vencido': c.overdueAmount ?? '',
    'Origen del monto vencido': c.overdueSource === 'REPORTED' ? 'Reportado por el archivo' : c.overdueSource === 'SCHEDULE' ? 'Cuotas vencidas' : '',
    'Último pago': day(c.lastPaymentAt),
    'Días de mora': c.daysPastDue,
    'Inicio de la mora': day(c.moraSince),
    'Origen de la mora': ARREARS_LABEL[c.arrearsSource] ?? c.arrearsSource,
    Fuente: source(c),
    'Corte del reporte': day(c.reportedAsOf),
    'Reporte desactualizado': yesNo(c.reportedStale),
    'Estado en origen': csvSafeText(c.reportedStatus),
    Situación: SITUATION_LABEL[c.situation] ?? '',
    Categoría: csvSafeText(c.category?.code),
    Castigado: yesNo(c.writtenOff),
    Prioridad: c.priority ? (PRIORITY_LABEL[c.priority] ?? c.priority) : '',
    Responsable: csvSafeText(c.responsibleId ? names.get(c.responsibleId) : undefined),
    Oficina: csvSafeText(c.branchName),
    'Última gestión': day(c.lastActionAt),
    'Tipo de última gestión': c.lastActivityType ? (ACTIVITY_LABEL[c.lastActivityType] ?? c.lastActivityType) : '',
    'Resultado de última gestión': csvSafeText(c.lastActivityResult),
    'Promesa vigente': yesNo(c.hasActivePromise),
  };
}

/** Nombres que `describeFilters` necesita y la consulta no trae: responsable y oficina elegidos. */
export interface FilterNames {
  assignee?: string;
  branch?: string;
}

/**
 * Los filtros que están aplicados, en palabras, para el encabezado del PDF. Quien lee el papel tiene que poder
 * saber qué se le dejó afuera: «Prioridad: Crítica» y «Días de mora ≥ 90» cambian el sentido de los totales.
 */
export function describeFilters(q: ListMoraQueryDto, names: FilterNames = {}): string[] {
  const out: string[] = [];
  if (q.q?.trim()) out.push(`Búsqueda: «${q.q.trim()}»`);
  if (q.todos === 'true') out.push('Incluye los créditos al día');
  if (q.dpdMin != null && q.dpdMax != null) out.push(`Días de mora: entre ${q.dpdMin} y ${q.dpdMax}`);
  else if (q.dpdMin != null) out.push(`Días de mora: ${q.dpdMin} o más`);
  else if (q.dpdMax != null) out.push(`Días de mora: hasta ${q.dpdMax}`);
  if (q.balanceMin != null) out.push(`Saldo desde ${q.balanceMin}`);
  if (q.balanceMax != null) out.push(`Saldo hasta ${q.balanceMax}`);
  const valid = new Set<string>(Object.values(CollectionPriority));
  const priorities = [...new Set((q.priority ?? '').split(',').map((p) => p.trim()).filter((p) => valid.has(p)))];
  if (priorities.length) out.push(`Prioridad: ${priorities.map((p) => PRIORITY_LABEL[p] ?? p).join(', ')}`);
  const categories = [...new Set((q.category ?? '').split(',').map((c) => c.trim()).filter((c) => c.length > 0))];
  if (categories.length) out.push(`Categoría de mora: ${categories.join(', ')}`);
  if (q.writtenOff === 'true') out.push('Sólo castigados');
  if (q.writtenOff === 'false') out.push('Sin los castigados');
  if (q.assigneeId) out.push(`Responsable: ${names.assignee ?? 'seleccionado'}`);
  if (q.unassigned === 'true') out.push('Créditos sin responsable');
  if (q.branchId) out.push(`Oficina: ${names.branch ?? 'seleccionada'}`);
  if (q.source) out.push(`Fuente: ${q.source}`);
  if (q.arrearsSource) out.push(`Origen de la mora: ${ARREARS_LABEL[q.arrearsSource] ?? q.arrearsSource}`);
  if (q.hasPromise === 'true') out.push('Con promesa de pago vigente');
  if (q.hasPromise === 'false') out.push('Sin promesa de pago vigente');
  if (q.zone?.trim()) out.push(`Zona: ${q.zone.trim()}`);
  return out;
}

/** El orden en palabras, para el encabezado: «días de mora (mayor a menor)». */
export function describeSort(sort?: string, dir?: string): string {
  const key = sort && Object.hasOwn(SORT_LABEL, sort) ? sort : 'daysPastDue';
  return `${SORT_LABEL[key]} (${dir === 'asc' ? 'menor a mayor' : 'mayor a menor'})`;
}

export interface MoraTotal {
  source: string;
  currency: string;
  count: number;
  balance: number;
  /** Suma sólo de los créditos que tienen el dato. */
  overdue: number;
  overdueKnown: number;
}

/**
 * Totales **por fuente y por moneda**, nunca mezclados (D7): una operación de PSF trae saldo y mora reportados a
 * su fecha de corte, y sumarla en silencio con las de Kobrax vende un número que no es de hoy. Tampoco se
 * suman monedas distintas.
 *
 * El vencido suma únicamente los créditos que lo tienen; cuántos son va aparte, para que el total no se lea
 * como el de toda la lista.
 */
export function moraTotals(items: MoraCreditListItem[]): MoraTotal[] {
  const map = new Map<string, MoraTotal>();
  for (const c of items) {
    const key = `${source(c)}|${c.currency}`;
    const t = map.get(key) ?? { source: source(c), currency: c.currency, count: 0, balance: 0, overdue: 0, overdueKnown: 0 };
    t.count += 1;
    t.balance += c.balance ?? 0;
    if (c.overdueAmount !== undefined) {
      t.overdue += c.overdueAmount;
      t.overdueKnown += 1;
    }
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.source.localeCompare(b.source) || a.currency.localeCompare(b.currency));
}

/** La fecha de corte del reporte: la más reciente entre las operaciones externas de la lista. */
export function moraCutoff(items: MoraCreditListItem[]): string | undefined {
  return items
    .map((c) => c.reportedAsOf)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
}

export interface MoraPdfContext {
  accountName: string;
  currency?: string;
  /** Quién lo generó. */
  generatedBy?: string;
  /** El cobrador sólo descarga lo suyo: el PDF lo dice. */
  ownOnly: boolean;
  /** El supervisor descarga su agencia (y lo suyo): el PDF lo dice. */
  branchScope?: boolean;
  filters: string[];
  sort: string;
  names: MoraNames;
  now?: Date;
}

const moneyIn = (currency: string, n: number): string =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

/**
 * El reporte de créditos en mora: un documento, no una captura de la pantalla. Título, fecha de generación,
 * fecha de corte, quién lo bajó, los filtros aplicados, totales por fuente y moneda, y la tabla paginada
 * con la cabecera repetida en cada hoja.
 */
export async function buildMoraPdf(items: MoraCreditListItem[], ctx: MoraPdfContext): Promise<Buffer> {
  const now = ctx.now ?? new Date();
  const cutoff = moraCutoff(items);
  const r = new Report({
    title: 'Créditos en mora',
    subtitle: cutoff ? `Corte de los reportes externos: ${cutoff}` : undefined,
    accountName: ctx.accountName,
    currency: ctx.currency,
  });

  r.facts([
    { label: 'Generado el', value: now.toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' }) },
    { label: 'Generado por', value: ctx.generatedBy ?? '—' },
    { label: 'Fecha de corte', value: cutoff ?? '—' },
    { label: 'Alcance', value: ctx.ownOnly ? 'Sólo los créditos a cargo de quien lo generó' : ctx.branchScope ? 'La agencia de quien lo generó y sus propios créditos' : 'Toda la cartera autorizada' },
    { label: 'Créditos', value: String(items.length) },
    { label: 'Orden', value: ctx.sort },
  ]);

  r.section('Filtros aplicados');
  r.bullets(ctx.filters, 'Sin filtros: todos los créditos en mora del alcance.');

  const totals = moraTotals(items);
  r.section('Totales');
  r.table<MoraTotal>(
    [
      { header: 'Fuente', width: 14, value: (t) => t.source, strong: true },
      { header: 'Moneda', width: 10, value: (t) => t.currency },
      { header: 'Créditos', width: 12, value: (t) => String(t.count), align: 'right' },
      { header: 'Saldo', width: 24, value: (t) => moneyIn(t.currency, t.balance), align: 'right' },
      { header: 'Vencido', width: 24, value: (t) => moneyIn(t.currency, t.overdue), align: 'right' },
      { header: 'Con vencido conocido', width: 16, value: (t) => `${t.overdueKnown} de ${t.count}`, align: 'right' },
    ],
    totals,
    { empty: 'No hay créditos con estos filtros.' },
  );
  r.note('Fuentes y monedas no se suman entre sí. El vencido suma sólo los créditos que lo tienen: un importado puede no traerlo.');

  r.section('Detalle');
  const columns: TableColumn<MoraCreditListItem>[] = [
    { header: 'Crédito', width: 14, value: (c) => c.code ?? '—', strong: true },
    { header: 'Deudor', width: 18, value: (c) => c.clientName ?? '—' },
    { header: 'Saldo', width: 13, value: (c) => (c.balance === undefined ? '—' : moneyIn(c.currency, c.balance)), align: 'right' },
    { header: 'Vencido', width: 13, value: (c) => (c.overdueAmount === undefined ? '—' : moneyIn(c.currency, c.overdueAmount)), align: 'right' },
    { header: 'Días', width: 6, value: (c) => String(c.daysPastDue), align: 'right', tone: (c) => arrearsTone(c.daysPastDue) },
    { header: 'Cat.', width: 5, value: (c) => c.category?.code ?? '—' },
    { header: 'Situación', width: 10, value: (c) => (c.writtenOff ? 'Castigado' : (SITUATION_LABEL[c.situation] ?? '—')) },
    { header: 'Prioridad', width: 9, value: (c) => (c.priority ? (PRIORITY_LABEL[c.priority] ?? c.priority) : '—') },
    { header: 'Responsable', width: 13, value: (c) => (c.responsibleId ? (ctx.names.get(c.responsibleId) ?? '—') : '—') },
    { header: 'Últ. gestión', width: 11, value: (c) => day(c.lastActionAt) || '—' },
  ];
  r.table(columns, items, { empty: 'No hay créditos con estos filtros.' });

  return r.finish();
}
