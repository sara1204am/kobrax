import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from './notifications.gateway';
import { PromiseDueService } from './promise-due.service';
import { DevicesController } from './push/devices.controller';
import { DevicesService } from './push/devices.service';
import { FCM_SENDER, FcmClient } from './push/fcm.client';
import { PushService } from './push/push.service';
import {
  EmailNotificationChannel,
  NOTIFICATION_CHANNELS,
  PushNotificationChannel,
  SmsNotificationChannel,
} from './notification-channel';

/**
 * F8 — Realtime + notificaciones. Gateway WS (rooms por tenant/usuario), traductor de
 * eventos de dominio → notificaciones persistidas + realtime, REST de bandeja y job PROMISE_DUE.
 */
@Module({
  imports: [AuthModule], // TokenService/SessionService + guards
  controllers: [NotificationsController, DevicesController],
  providers: [
    RealtimeGateway,
    NotificationsService,
    PromiseDueService,
    // Push remoto (D-4): el proveedor se inyecta por token para poder probarlo sin red.
    FcmClient,
    { provide: FCM_SENDER, useExisting: FcmClient },
    PushService,
    DevicesService,
    PushNotificationChannel,
    SmsNotificationChannel,
    EmailNotificationChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      inject: [PushNotificationChannel, SmsNotificationChannel, EmailNotificationChannel],
      useFactory: (push: PushNotificationChannel, sms: SmsNotificationChannel, email: EmailNotificationChannel) => [push, sms, email],
    },
  ],
  exports: [RealtimeGateway, NotificationsService],
})
export class NotificationsModule {}
