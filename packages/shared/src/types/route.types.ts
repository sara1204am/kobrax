/**
 * Contrato de las rutas de campo y de las visitas (`/routes`, `/visits`).
 *
 * Vive acá porque lo consumen el móvil y el panel web, y la forma está verificada contra
 * `routes.serializer.ts` y `field.serializer.ts` de la API — las fechas llegan como ISO string.
 */
import type { EvidenceType, RouteStatus, RouteStopStatus, VisitOutcome } from '../enums/index.js';
import type { RouteCapabilities } from '../utils/route-rules.js';
import type { ExternalSyncStatus } from '../enums/credit.enum.js';

export interface RouteStopItem {
  id: string;
  clientId: string;
  sequenceOrder: number;
  status: RouteStopStatus;
  visitedAt?: string;
  /** Sólo en `GET /routes/:id`: el listado no trae paradas, y generar tampoco las enriquece. */
  clientName?: string;
  /** Dirección donde se cobra (HOME, si no la primera cargada). Vacía si el cliente no tiene ninguna. */
  address?: string;
  /** El punto de esa misma ubicación. Sin él la parada existe pero no se puede dibujar. */
  latitude?: number;
  longitude?: number;
  /** El crédito de la parada (F4/08: la parada es por crédito): contra él se cobra y se promete al registrar el resultado. */
  creditId?: string;
  /** La visita agendada de la que nació la parada (F4/11). Al visitarla, esa gestión se cierra sola. */
  agendaItemId?: string;
  /** La ubicación concreta que se visita (`client_locations.id`): casa, trabajo, la de un garante… Ausente en paradas viejas. */
  locationId?: string;
  /** De qué es la ubicación (`LocationType`) y de quién, para decir «Garante · Juan Pérez». Solo en `GET /routes/:id`. */
  locationType?: string;
  locationOwner?: string;
  /** La foto principal de la ubicación (la primera de sus fotos), para reconocer la casa en el mapa. */
  locationPhotoUrl?: string;
  /** Todas las fotos de esa ubicación (la principal primero). Ausente si no tiene. */
  locationPhotoUrls?: string[];
  /** La hora de la visita agendada de la que nació (`HH:mm`): hora fija = posición fija. Ausente si no tiene hora fija. */
  scheduledTime?: string;
  /** El crédito es de otra persona del equipo: la parada va como «Ayuda». */
  isHelp?: boolean;
  /**
   * La deuda del crédito **de esta parada**, no la suma del deudor: un cliente puede tener más de
   * un crédito y la parada apunta a uno. Ausentes si la parada no tiene caso o crédito.
   */
  overdueAmount?: number;
  /** La cuota que correspondía pagar (lo pendiente del cronograma, o lo congelado/reportado). Ausente si no hay dato. */
  installmentAmount?: number;
  /** Cuándo vence esa cuota (`YYYY-MM-DD`). Solo con cronograma. */
  nextDueDate?: string;
  /** Con qué monto arranca un cobro: la cuota acotada al saldo, o lo reportado en mora. Misma regla que el móvil. */
  suggestedPaymentAmount?: number;
  currency?: string;
  daysPastDue?: number;
  /** Cómo terminó la parada. `undefined` = todavía no se visitó. */
  lastOutcome?: VisitOutcome;
  /**
   * El crédito de la parada es de una fuente externa (D1): su saldo es el **reportado** al corte y un
   * pago no lo baja (D3), así que el cobro no se topea con él. Ausente = Kobrax.
   */
  externalSource?: string;
  syncStatus?: ExternalSyncStatus;
  reportedAsOf?: string;
}

/**
 * Cómo se puede ordenar `GET /routes`. La primera es el default (fecha, descendente).
 *
 * Mismo contrato que `MORA_SORTS`: la API decide qué sabe ordenar y el panel qué columnas ofrece.
 *
 * 🔴 **Paradas y distancia no están, y es a propósito.** «Paradas» muestra `visitadas / planificadas`
 * y las visitadas se cuentan aparte del listado, así que ordenar por esa columna ordenaría por el
 * total —no por lo que se ve— y la flecha estaría mintiendo. La distancia sólo existe si alguien
 * previsualizó la ruta: ordenar por ella pondría arriba a quien abrió el mapa, no a quien más anduvo.
 */
export const ROUTE_SORTS = ['date', 'collector', 'status'] as const;
export type RouteSort = (typeof ROUTE_SORTS)[number];

export interface RouteItem {
  id: string;
  collectorId: string;
  branchId?: string;
  plannedDate: string;
  status: RouteStatus;
  /** Paradas planificadas. Se escribe al armar la ruta. Nombre legado (antes «casos»): hoy cuenta paradas. */
  totalCases: number;
  /**
   * Paradas ya visitadas, para poder decir «5 de 8» sin traer las paradas.
   *
   * Sólo lo llena `GET /routes` (el listado). En el detalle es `undefined` **a propósito**: ahí
   * están las paradas de verdad, y un contador al lado que se calcule distinto es la forma segura
   * de que un día dejen de coincidir.
   */
  visitedCount?: number;
  /** Primera parada sin gestionar. Solo en el listado. */
  nextStop?: RouteNextStop;
  /** Lo cobrado ese día por el cobrador de la ruta (día civil de la empresa). Solo en el listado. */
  collected?: number;
  totalDistanceKm?: number;
  estimatedMinutes?: number;
  createdAt: string;
  /** Quién la armó (`users.id`). Ausente en las anteriores a F4/12. */
  createdBy?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  /** El motivo escrito de cerrar con paradas sin gestionar, o de cancelar. */
  statusReason?: string;
  /** Lo que quien mira puede hacer con esta ruta, resuelto por la API. Solo en el detalle. */
  capabilities?: RouteCapabilities;
  /** Pedidos de cambio sin resolver: se muestran a quien puede aprobarlos. Solo en el detalle. */
  pendingRequests?: number;
  stops?: RouteStopItem[];
}

/** La parada siguiente de una ruta, para la vista «Hoy». Solo en `GET /routes` (el listado no trae paradas). */
export interface RouteNextStop {
  id: string;
  sequenceOrder: number;
  clientName?: string;
}

/**
 * Una visita registrada en la calle (`GET /visits`).
 *
 * **Inmutable por diseño**: `field_visits` no tiene `updated_at` ni `deleted_at`. Es justo lo que
 * la vuelve prueba, así que ninguna pantalla ofrece editarla ni borrarla.
 */
export interface VisitItem {
  id: string;
  /** El crédito visitado (F4/08). */
  creditId?: string;
  routeStopId?: string;
  collectorId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  outcome: VisitOutcome;
  notes?: string;
  /** Campos propios de la variante, validados por `validateVisitDetails`. */
  details: Record<string, unknown>;
  capturedAt: string;
  /** Quién la registró (`users.id`) y desde dónde. Una visita desde el panel la marca quien la cargó, no el cobrador. */
  registeredBy?: string;
  source?: 'MOBILE' | 'WEB';
  /** Una visita no se edita: la corrección es una visita nueva que apunta a la que corrige. */
  correctsVisitId?: string;
}

/** Una evidencia sellada: la foto o la firma, con el hash que prueba que no cambió. */
export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  /**
   * La **ruta** del archivo, no su nombre: `uploads` devuelve `/api/uploads/<nombre>` y es lo que
   * se guarda tal cual. Sirve igual en el móvil y en el panel, porque los dos tienen esa ruta —
   * en el panel pega en su BFF, que proxea con el Bearer.
   *
   * Puede ser una URL externa en datos viejos, anteriores al módulo de subida.
   */
  fileUrl: string;
  /** SHA-256 del buffer original, entero. */
  fileHash: string;
  latitude?: number;
  longitude?: number;
  capturedAt: string;
}

export interface VisitDetail extends VisitItem {
  evidences: EvidenceItem[];
}

/** Lo que se puede pedir sobre una ruta ajena (decisión 1 de F4/12). */
export const ROUTE_CHANGE_KINDS = ['ADD_STOP', 'REMOVE_STOP', 'REORDER', 'CANCEL'] as const;
export type RouteChangeKind = (typeof ROUTE_CHANGE_KINDS)[number];

export const ROUTE_CHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type RouteChangeStatus = (typeof ROUTE_CHANGE_STATUSES)[number];

/** Un pedido de cambio (`GET /routes/:id/change-requests`). */
export interface RouteChangeRequestItem {
  id: string;
  routeId: string;
  requestedBy: string;
  requestedByName?: string;
  kind: RouteChangeKind;
  /** `{clientId, creditId?, locationId?}` · `{stopId}` · `{stopId, sequenceOrder}` · `{}`. */
  payload: Record<string, unknown>;
  reason: string;
  status: RouteChangeStatus;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  createdAt: string;
}
