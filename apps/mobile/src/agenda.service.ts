/**
 * Gestiones agendadas (lectura S1 + alta S2). Thin sobre `apiQuery`/`apiMutate`. Tipos verificados
 * contra `agenda.serializer.ts` del API (fechas llegan como ISO string vía JSON).
 */
// Se importan además de re-exportarse: un `export ... from` no trae los nombres al scope local.
import type {
  AgendaItemDetail,
  AgendaListItem,
  AgendaOutcome,
  AgendaPostponeStep,
  AgendaTodaySummary,
  AgendaTarget,
  AgendaTimeSlot,
  CollectionProfile,
  CreateAgendaInput,
  ScheduleTimeMode,
  UpdateAgendaInput,
} from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import { setTenantToday } from './tenant-day';
import { cachedList, cachedOne } from './sync/cached';

/**
 * Los tipos del contrato viven en `@kobrax/shared` (F9 W5 T1): los consume también el panel web.
 * Acá se re-exportan para que las pantallas sigan importando de un solo lado.
 */
export type {
  AgendaHistoryEntry,
  AgendaItemDetail,
  AgendaListItem,
  AgendaTarget,
  CreateAgendaInput,
  UpdateAgendaInput,
} from '@kobrax/shared';

/**
 * «¿Qué tengo que hacer hoy?»: pendientes de hoy, vencidas y próximas, con el día civil de la empresa (`date`). Es la fuente de
 * «hoy» del teléfono (`tenant-day.ts`): el servidor y el panel cuentan igual.
 */
export function getSummary(): Promise<QueryResult<AgendaTodaySummary>> {
  return apiQuery<AgendaTodaySummary>('/agenda/summary');
}

/**
 * El resumen de hoy **con respaldo local** (contadores del Inicio). Sin señal devuelve el último guardado con `localAt`;
 * quien lo muestre decide si todavía vale (`summaryView`). `getSummary` queda sin caché a propósito: de él sale «hoy» y un
 * resumen viejo fijaría un día equivocado.
 */
export function getSummaryCached(): Promise<QueryResult<AgendaTodaySummary>> {
  return cachedOne<AgendaTodaySummary>('agenda.summary', 'today', () => apiQuery<AgendaTodaySummary>('/agenda/summary'));
}

/** Le pregunta al servidor qué día es para la empresa y lo recuerda. Sin red no hace nada: queda el día local del teléfono. */
export async function refreshTenantToday(): Promise<void> {
  const res = await getSummary();
  if (res.status === 'ok') setTenantToday(res.data.date);
}

/** Agendados de un día (`YYYY-MM-DD`). El móvil separa secciones por `status`. */
export function listByDay(dateISO: string): Promise<QueryResult<AgendaListItem[]>> {
  // El scope es el día: la agenda de hoy y la de mañana no se pisan en la base local.
  return cachedList<AgendaListItem>('agenda', dateISO, () =>
    apiQuery<AgendaListItem[]>(`/agenda${toQuery({ date: dateISO })}`),
  );
}

/** Vencidos (SCHEDULED con fecha < hoy), desc. `total` = `meta.total` (para "ver más"). */
export function listOverdue(limit = 100): Promise<QueryResult<AgendaListItem[]>> {
  // El límite entra en el scope: el Home pide `limit=1` (sólo el total) y la Agenda `limit=100`. Con un scope
  // único, la consulta de 1 fila reemplazaba las 100 guardadas y sin señal la lista quedaba con un solo vencido.
  return cachedList<AgendaListItem>('agenda', `overdue:limit=${limit}`, () =>
    apiQuery<AgendaListItem[]>(`/agenda/overdue${toQuery({ limit })}`),
  );
}

/** Con qué se ejecuta la gestión: el teléfono al que llamar o la dirección a la que ir. */
/** Detalle de una gestión (S3). Un round-trip: gestión + deudor + saldo + contacto + historial. */
export function getItem(id: string): Promise<QueryResult<AgendaItemDetail>> {
  return cachedOne<AgendaItemDetail>('agenda.detail', id, () => apiQuery<AgendaItemDetail>(`/agenda/${id}`));
}

/** Registrar la ejecución (S4): outcome + nota → el ítem pasa a EXECUTED. Devuelve el ítem actualizado. */
export function completeItem(id: string, outcome: AgendaOutcome, notes?: string, context?: ActivityContext): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}/complete`, 'POST', { outcome, notes, ...context });
}

/** Contexto opcional de una gestión (F4/13 · E4). Solo viaja lo que se eligió. */
export interface ActivityContext {
  reasonCode?: string;
  expectedIncomeDate?: string;
  payerParty?: string;
  /** Plantilla de mensaje **elegida** (F4/13 · E5), no la enviada: `wa.me` no confirma el envío. */
  templateCode?: string;
}

/**
 * Posponer en pasos fijos (S4). El ítem sigue pendiente, con la hora corrida.
 *
 * `toTime` (HH:mm) es la hora **absoluta** de destino: repetir el envío la deja en el mismo valor, mientras que
 * `minutes` es relativo y cada repetición correría la hora otro tanto. Se manda `minutes` también para que un
 * server viejo siga funcionando; el nuevo da prioridad a `toTime`.
 */
export function postponeItem(id: string, minutes: AgendaPostponeStep, toTime?: string): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}/postpone`, 'POST', toTime ? { minutes, toTime } : { minutes });
}

/** Inicio de cada franja, en minutos: el MISMO criterio con el que el server calcula la base de un agendado por franja. */
const SLOT_START_MINUTES: Record<string, number> = { MORNING: 8 * 60, AFTERNOON: 13 * 60, NIGHT: 18 * 60 };

/**
 * La hora absoluta (`HH:mm`) a la que queda una gestión al posponerla `minutes`. Espeja la aritmética del server
 * (base = hora fija, o inicio de la franja, o 09:00).
 *
 * D-8 — **Posponer no cambia de día.** Devuelve `undefined` si la hora llegaría a la medianoche o pasada: no hay un destino
 * válido y la pantalla debe decirlo (la salida es «Reagendar»), no mandar el pedido y que el servidor lo rechace.
 *
 * Una gestión de HOY que ya venció se pospone **desde ahora**, no sobre su hora vieja (que seguiría en el pasado): quien
 * llama pasa `nowMinutes` (minutos desde la medianoche, en el reloj del teléfono, que es el que muestra los avisos).
 */
export function postponeTarget(
  item: { scheduledTime?: string | null; timeSlot?: string | null },
  minutes: AgendaPostponeStep,
  opts: { nowMinutes?: number } = {},
): string | undefined {
  const m = item.scheduledTime ? /^(\d{1,2}):(\d{2})/.exec(item.scheduledTime) : null;
  const scheduled = m ? Number(m[1]) * 60 + Number(m[2]) : (SLOT_START_MINUTES[item.timeSlot ?? ''] ?? 9 * 60);
  const base = opts.nowMinutes === undefined ? scheduled : Math.max(scheduled, opts.nowMinutes);
  const total = base + minutes;
  if (total >= 24 * 60) return undefined;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * URLs nativas para los botones del detalle. Sin teléfono no hay `tel:`; sin coordenadas se navega
 * **por texto**, que es lo que hace Maps cuando la dirección no tiene punto.
 *
 * `platform` decide el esquema del mapa: `geo:` sólo existe en Android — en iOS `Linking.openURL`
 * lo rechaza y el botón Navegar nunca abriría nada. Se pasa por parámetro para que el helper siga
 * siendo puro y testeable en los dos sistemas.
 */
export function actionLinks(
  target?: AgendaTarget,
  platform: 'ios' | 'android' | string = 'android',
): { tel?: string; geo?: string } {
  if (!target) return {};
  const tel = target.phone ? `tel:${target.phone.replace(/[^\d+]/g, '')}` : undefined;
  const ios = platform === 'ios';
  const geo =
    target.latitude != null && target.longitude != null
      ? ios
        ? `maps:0,0?ll=${target.latitude},${target.longitude}`
        : `geo:${target.latitude},${target.longitude}?q=${target.latitude},${target.longitude}`
      : target.address
        ? `${ios ? 'maps:0,0' : 'geo:0,0'}?q=${encodeURIComponent(target.address)}`
        : undefined;
  return { ...(tel && { tel }), ...(geo && { geo }) };
}

/**
 * Un agendado de WhatsApp abre WhatsApp con el mensaje ya escrito — no una llamada de voz. La regla es la misma que en la
 * web, así que vive en shared; se re-exporta acá para que las pantallas del móvil sigan importándola de este servicio.
 */
export { whatsappLink } from '@kobrax/shared';

/** Un crédito del cliente dentro de mi alcance (en mora o al día): lo que se puede agendar. */
export interface CreditOption {
  creditId: string;
  code?: string;
  /** Capital original del crédito. */
  principalAmount: number;
  outstandingBalance: number;
  /** Suma impaga de las cuotas vencidas; `0` si el crédito no tiene cronograma. */
  overdueAmount: number;
  currency: string;
  daysPastDue: number;
}

/** "En mora · 12 días" | "Al día" — lo que se muestra al elegir el crédito. */
export function creditSituationLabel(daysPastDue: number): string {
  if (daysPastDue <= 0) return 'Al día';
  return `En mora · ${daysPastDue} ${daysPastDue === 1 ? 'día' : 'días'}`;
}

export interface ContactOption {
  id: string;
  contactType: string;
  /** En claro (el endpoint revela PII con auditoría). */
  value: string | null;
  isPrimary: boolean;
}

export interface LocationOption {
  id: string;
  locationType: string;
  address: string | null;
  zone?: string;
  latitude?: number;
  longitude?: number;
  /** Rutas `/api/uploads/…`; la primera es la principal. */
  photoUrls?: string[];
  /** Cómo conviene cobrarle en este lugar (F4/13 · E2). Ausente si nunca se cargó. */
  visitSchedule?: CollectionProfile | null;
  /** Solo en las de garantes y familiares: de quién es la dirección y qué relación tiene con el deudor. */
  ownerName?: string;
  ownerRelation?: string;
}

export interface AgendaClientContext {
  client: { id: string; displayName: string; nationalId: string | null };
  credits: CreditOption[];
  contacts: ContactOption[];
  locations: LocationOption[];
  /**
   * En qué franja se contactó efectivamente a este deudor antes (Rutas S4). **Ausente cuando el
   * historial no alcanza** — la regla la decide el server; acá sólo se pinta lo que llega.
   */
  contactHint?: { timeSlot: AgendaTimeSlot; basedOn: number };
}

/**
 * Todo lo que el alta necesita del cliente elegido, en un round-trip: créditos agendables +
 * teléfonos y direcciones en claro. `error` si el cliente no tiene créditos en mi alcance (AGENDA_002).
 */
export function clientContext(clientId: string): Promise<QueryResult<AgendaClientContext>> {
  // Con respaldo local: sin esto, sin señal se puede BUSCAR al deudor pero no abrirlo, que es
  // peor que no encontrarlo — se ve el nombre y la pantalla siguiente no carga.
  return cachedOne<AgendaClientContext>('client.context', clientId, () =>
    apiQuery<AgendaClientContext>(`/agenda/clients/${clientId}/context`),
  );
}

/**
 * El contexto del cliente **sin respaldo local**: la cola lo usa para mirar qué tiene el server de verdad antes
 * de repetir un alta que no lleva id. Con `clientContext` (con caché), sin señal devolvería lo viejo y la
 * búsqueda previa daría por inexistente algo que sí subió.
 */
export function clientContextLive(clientId: string): Promise<QueryResult<AgendaClientContext>> {
  return apiQuery<AgendaClientContext>(`/agenda/clients/${clientId}/context`);
}

/** Cuerpo de `POST /agenda`. El server deriva `clientId` y `assigneeId` — no van acá. */
/** Alta. Devuelve el ítem serializado → la pantalla lo inserta sin refetch. */
export function createItem(input: CreateAgendaInput): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>('/agenda', 'POST', input);
}

/**
 * Cuerpo de `PATCH /agenda/:id` (S5). **Sin `scheduledDate` ni deudor**: mover el día es reagendar
 * (deja rastro) y el cliente es el ancla del agendado. Se manda sólo lo que cambió.
 */
/** Edita una gestión pendiente (S5). Devuelve el ítem actualizado. */
export function updateItem(id: string, input: UpdateAgendaInput): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}`, 'PATCH', input);
}

/** Cancela con motivo del catálogo `CANCEL_REASON` (S6). Sigue visible, con estado Cancelada. */
export function cancelItem(id: string, reasonCode: string): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}/cancel`, 'POST', { reasonCode });
}

/** Cuerpo de `POST /agenda/:id/reschedule`. El motivo sale del catálogo `RESCHEDULE_REASON`. */
export interface RescheduleAgendaInput {
  scheduledDate: string;
  timeMode: ScheduleTimeMode;
  scheduledTime?: string;
  timeSlot?: string;
  reasonCode: string;
}

/** Reagenda a otro día (S6): cierra ésta como Reagendada y **devuelve la nueva**. */
export function rescheduleItem(id: string, input: RescheduleAgendaInput): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}/reschedule`, 'POST', input);
}

/** Elimina (soft-delete) una gestión cargada por error (S6). Responde 200 con el ítem, no 204. */
export function deleteItem(id: string): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}`, 'DELETE');
}

/** Canales que sirven para llamar o escribir. El endpoint rechaza `EMAIL`. */
export type PhoneContactType = 'PHONE' | 'WHATSAPP';

export interface NewClientContact {
  contactType: PhoneContactType;
  value: string;
  notes?: string;
}

/**
 * Carga un teléfono que el cliente no tenía, sin salir del formulario. Va por `agenda:write`
 * (el cobrador no tiene `client:write`). Devuelve el contacto listo para seleccionar.
 */
export function addClientContact(clientId: string, input: NewClientContact): Promise<MutateResult<ContactOption>> {
  return apiMutate<ContactOption>(`/agenda/clients/${clientId}/contacts`, 'POST', input);
}

/** Los del enum `LocationType` de Prisma. */
export type ClientLocationType = 'HOME' | 'WORK' | 'GUARANTOR' | 'FAMILY' | 'OTHER';

export interface NewClientLocation {
  locationType: ClientLocationType;
  address: string;
  zone?: string;
  /** Opcionales: se puede cargar la dirección sin marcar el punto. */
  latitude?: number;
  longitude?: number;
  referenceNotes?: string;
}

/** Carga una dirección que el cliente no tenía. Devuelve la ubicación lista para seleccionar. */
export function addClientLocation(clientId: string, input: NewClientLocation): Promise<MutateResult<LocationOption>> {
  return apiMutate<LocationOption>(`/agenda/clients/${clientId}/locations`, 'POST', input);
}

/**
 * Corrige una dirección ya cargada — sobre todo, marcarle el punto a una importada, que llega sin
 * coordenadas. Se edita la que existe en vez de crear una segunda: el mapa dibuja la ubicación
 * primaria, así que una copia nueva no serviría de nada.
 */
export function updateClientLocation(
  clientId: string,
  locationId: string,
  input: Partial<NewClientLocation>,
): Promise<MutateResult<LocationOption>> {
  return apiMutate<LocationOption>(`/agenda/clients/${clientId}/locations/${locationId}`, 'PATCH', input);
}
