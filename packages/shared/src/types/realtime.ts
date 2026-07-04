import type { NotificationType } from '../enums/notification-type.enum.js';

/**
 * Contrato de realtime (F8) — **fuente única** para API (emisor), web y mobile (consumidores).
 * Los emisores de dominio (F5/F6/F7) producen estos payloads; el `RealtimeGateway` los
 * difunde por Socket.io en el namespace `/events`. Desacopla productores de consumidores.
 */

/** Namespace de Socket.io donde vive el canal de eventos. */
export const REALTIME_NAMESPACE = '/events';

/** Nombres canónicos de los eventos de realtime (server→client, salvo `COLLECTOR_LOCATION` que es bidireccional). */
export const RealtimeEvent = {
  CASE_ASSIGNED: 'case.assigned',
  CASE_UPDATED: 'case.updated',
  PAYMENT_REGISTERED: 'payment.registered',
  ROUTE_COMPLETED: 'route.completed',
  COLLECTOR_LOCATION: 'collector.location',
  NOTIFICATION: 'notification',
} as const;

export type RealtimeEventName = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

// ── Payloads server→client ─────────────────────────────────────────────────────
export interface CaseAssignedPayload {
  caseId: string;
  collectorId: string;
  accountId: string;
}

export interface CaseUpdatedPayload {
  caseId: string;
  accountId: string;
  status?: string;
  activity?: string;
}

export interface PaymentRegisteredPayload {
  paymentId: string;
  creditId: string;
  amount: number;
  accountId: string;
}

export interface RouteCompletedPayload {
  routeId: string;
  collectorId: string;
  accountId: string;
}

export interface CollectorLocationPayload {
  collectorId: string;
  lat: number;
  lng: number;
  accountId: string;
  /** ISO timestamp del servidor al difundir. */
  at?: string;
}

/** Notificación persistida entregada en vivo (espejo de la fila de `notifications`). */
export interface NotificationPayload {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  clientId: string | null;
  creditId: string | null;
  caseId: string | null;
  readAt: string | null;
  createdAt: string;
}

// ── Payload client→server ──────────────────────────────────────────────────────
/** Ping de ubicación que envía el móvil del cobrador (throttled server-side). */
export interface CollectorLocationInput {
  lat: number;
  lng: number;
}

/** Mapa de eventos server→client (tipado end-to-end para socket.io). */
export interface ServerToClientEvents {
  [RealtimeEvent.CASE_ASSIGNED]: (p: CaseAssignedPayload) => void;
  [RealtimeEvent.CASE_UPDATED]: (p: CaseUpdatedPayload) => void;
  [RealtimeEvent.PAYMENT_REGISTERED]: (p: PaymentRegisteredPayload) => void;
  [RealtimeEvent.ROUTE_COMPLETED]: (p: RouteCompletedPayload) => void;
  [RealtimeEvent.COLLECTOR_LOCATION]: (p: CollectorLocationPayload) => void;
  [RealtimeEvent.NOTIFICATION]: (p: NotificationPayload) => void;
}

/** Mapa de eventos client→server. */
export interface ClientToServerEvents {
  [RealtimeEvent.COLLECTOR_LOCATION]: (p: CollectorLocationInput) => void;
}
