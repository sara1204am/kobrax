import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/** Nombres de eventos de dominio (contrato para F8: realtime + notificaciones). */
export const DomainEvent = {
  PAYMENT_REGISTERED: 'payment.registered',
  ROUTE_COMPLETED: 'route.completed',
  /** Algo de una ruta le toca a OTRA persona: la asignaron, la cancelaron, le piden o le resolvieron un cambio (F4/12). */
  ROUTE_NOTICE: 'route.notice',
  /** Una gestión de agenda se le asignó a alguien que no es quien la creó (F4/11). */
  AGENDA_ASSIGNED: 'agenda.assigned',
  /** Alguien que no es el responsable cambió una gestión: la reagendó, canceló, eliminó o editó. */
  AGENDA_CHANGED: 'agenda.changed',
} as const;

/** Lo que viaja en el aviso de una ruta: lo justo para redactarlo sin volver a consultar. */
export interface RouteNoticePayload {
  accountId: string;
  routeId: string;
  /** Quien recibe el aviso. */
  recipientId: string;
  /** Quien hizo el cambio. */
  actorId: string;
  kind: 'ASSIGNED' | 'CANCELLED' | 'CHANGE_REQUESTED' | 'CHANGE_APPROVED' | 'CHANGE_REJECTED';
  /** `YYYY-MM-DD` de la ruta. */
  plannedDate?: string;
  stops?: number;
  /** Motivo escrito (cancelación, pedido) o nota de quien resolvió. */
  reason?: string;
  /** Qué se pidió, para el texto: «agregar una parada», «quitar una parada»… */
  requestKind?: string;
}

/** Lo que viaja en los eventos de agenda: lo justo para redactar el aviso sin volver a consultar. */
export interface AgendaEventPayload {
  accountId: string;
  itemId: string;
  creditId: string;
  clientId: string;
  /** Quién recibe el aviso: el responsable de la gestión. */
  recipientId: string;
  /** Quién hizo el cambio. */
  actorId: string;
  actorName?: string;
  clientName?: string;
  itemType: string;
  /** `YYYY-MM-DD` de la gestión (la nueva fecha si se reagendó). */
  scheduledDate: string;
  kind: 'ASSIGNED' | 'RESCHEDULED' | 'CANCELLED' | 'DELETED' | 'UPDATED' | 'REASSIGNED';
}

/**
 * Bus de eventos de dominio en proceso. Los módulos de negocio (F5/F6/F7) **emiten**;
 * F8 **suscribe** y los traduce a WebSocket + notificaciones persistidas. Desacopla
 * emisores de consumidores. Implementación mínima con node:events (sin dependencias).
 */
@Injectable()
export class EventBusService {
  private readonly emitter = new EventEmitter();

  emit(event: string, payload: unknown): void {
    this.emitter.emit(event, payload);
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.emitter.on(event, handler);
  }
}
