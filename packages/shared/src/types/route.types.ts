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

export interface RouteItem {
  id: string;
  collectorId: string;
  branchId?: string;
  plannedDate: string;
  status: RouteStatus;
  totalCases: number;
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
  /** El NOMBRE del archivo: se sirve por `GET /uploads/:name`, la única puerta que valida el tenant. */
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
