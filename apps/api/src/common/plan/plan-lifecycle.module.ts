import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { PlanLifecycleService } from './plan-lifecycle.service';

/**
 * El job diario del ciclo de vida comercial (L4). Módulo propio y no dentro de `PlanModule`:
 * aquél lo importan todos los que frenan, y arrastrarles el gateway de notificaciones y el
 * correo sería colgarle el mundo a cada `assertRoom`.
 */
@Module({
  imports: [NotificationsModule, MailModule],
  providers: [PlanLifecycleService],
  exports: [PlanLifecycleService],
})
export class PlanLifecycleModule {}
