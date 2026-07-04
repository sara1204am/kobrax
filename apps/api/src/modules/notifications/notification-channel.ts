import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';

/** Token DI para la lista de canales de salida (push/SMS/email). */
export const NOTIFICATION_CHANNELS = 'NOTIFICATION_CHANNELS';

/** Datos mínimos que un canal necesita para entregar una notificación fuera de la app. */
export interface OutboundNotification {
  userId: string;
  accountId: string;
  type: NotificationType;
  title: string;
  body: string | null;
}

/**
 * Canal de entrega externo (M6). F8 deja la **interfaz** y stubs; el proveedor real
 * (FCM/APNs/Twilio/SES) se inyecta después sin tocar el traductor de eventos.
 */
export interface NotificationChannel {
  readonly name: string;
  deliver(notification: OutboundNotification): Promise<void>;
}

abstract class LoggingChannelStub implements NotificationChannel {
  protected readonly logger = new Logger(this.constructor.name);
  abstract readonly name: string;

  async deliver(n: OutboundNotification): Promise<void> {
    // Stub: el proveedor real se cablea luego. No bloquea ni falla el flujo.
    this.logger.debug(`[${this.name}] (stub) → user=${n.userId} type=${n.type} "${n.title}"`);
  }
}

@Injectable()
export class PushNotificationChannel extends LoggingChannelStub {
  readonly name = 'push';
}

@Injectable()
export class SmsNotificationChannel extends LoggingChannelStub {
  readonly name = 'sms';
}

@Injectable()
export class EmailNotificationChannel extends LoggingChannelStub {
  readonly name = 'email';
}
