/**
 * Contrato de las rutas de campo y de las visitas (`/routes`, `/visits`).
 *
 * Vive acá porque lo consumen el móvil y el panel web, y la forma está verificada contra
 * `routes.serializer.ts` y `field.serializer.ts` de la API — las fechas llegan como ISO string.
 */
import type { EvidenceType, RouteStatus, RouteStopStatus, VisitOutcome } from '../enums/index.js';

export interface RouteStopItem {
  id: string;
  clientId: string;
  caseId?: string;
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
  /** El crédito del caso de la parada: contra él se cobra y se promete al registrar el resultado. */
  creditId?: string;
  /**
   * La deuda del crédito **de esta parada**, no la suma del deudor: un cliente puede tener más de
   * un crédito y la parada apunta a uno. Ausentes si la parada no tiene caso o crédito.
   */
  overdueAmount?: number;
  currency?: string;
  daysPastDue?: number;
  /** Cómo terminó la parada. `undefined` = todavía no se visitó. */
  lastOutcome?: VisitOutcome;
}

/**
 * Cómo se puede ordenar `GET /routes`. La primera es el default (fecha, descendente).
 *
 * Mismo contrato que `CASE_SORTS`: la API decide qué sabe ordenar y el panel qué columnas ofrece.
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
  /** Paradas planificadas. Se escribe al armar la ruta. */
  totalCases: number;
  /**
   * Paradas ya visitadas, para poder decir «5 de 8» sin traer las paradas.
   *
   * Sólo lo llena `GET /routes` (el listado). En el detalle es `undefined` **a propósito**: ahí
   * están las paradas de verdad, y un contador al lado que se calcule distinto es la forma segura
   * de que un día dejen de coincidir.
   */
  visitedCount?: number;
  totalDistanceKm?: number;
  estimatedMinutes?: number;
  createdAt: string;
  stops?: RouteStopItem[];
}

/**
 * Una visita registrada en la calle (`GET /visits`).
 *
 * **Inmutable por diseño**: `field_visits` no tiene `updated_at` ni `deleted_at`. Es justo lo que
 * la vuelve prueba, así que ninguna pantalla ofrece editarla ni borrarla.
 */
export interface VisitItem {
  id: string;
  caseId?: string;
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
