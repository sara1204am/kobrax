import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/** Nombres de eventos de dominio (contrato para F8: realtime + notificaciones). */
export const DomainEvent = {
  CASE_ASSIGNED: 'case.assigned',
  CASE_UPDATED: 'case.updated',
  PAYMENT_REGISTERED: 'payment.registered',
  ROUTE_COMPLETED: 'route.completed',
} as const;

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
