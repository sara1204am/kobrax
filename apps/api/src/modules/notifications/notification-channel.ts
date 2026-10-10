import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { PushService } from './push/push.service';

/** Token DI para la lista de canales de salida (push/SMS/email). */
export const NOTIFICATION_CHANNELS = 'NOTIFICATION_CHANNELS';

/** Datos mínimos que un canal necesita para entregar una notificación fuera de la app. */
export interface OutboundNotification {
  /** Id de la notificación persistida: el push lo usa de `tag` para no duplicarse. */
  id?: string;
  routeId?: string | null;
  agendaItemId?: string | null;
  creditId?: string | null;
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

/**
 * Push remoto (FCM). Entrega por `PushService`, que decide qué tipos salen, a qué dispositivos y con qué texto genérico.
 * Sin credenciales de Firebase (o sin dispositivos) no hace nada y **no falla**: la notificación interna y el WebSocket ya
 * salieron antes y no dependen de este canal.
 */
@Injectable()
export class PushNotificationChannel implements NotificationChannel {
  readonly name = 'push';
  constructor(private readonly push: PushService) {}

  async deliver(n: OutboundNotification): Promise<void> {
    if (!n.id || !PushService.isPushable(n.type)) return;
    await this.push.sendToUser({
      accountId: n.accountId,
      userId: n.userId,
      notificationId: n.id,
      type: n.type,
      routeId: n.routeId,
      agendaItemId: n.agendaItemId,
      creditId: n.creditId,
    });
  }
}

@Injectable()
export class SmsNotificationChannel extends LoggingChannelStub {
  readonly name = 'sms';
}

@Injectable()
export class EmailNotificationChannel extends LoggingChannelStub {
  readonly name = 'email';
}
