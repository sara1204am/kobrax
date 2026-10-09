import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ClientsModule } from '../clients/clients.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgendaController } from './agenda.controller';
import { AgendaOverdueService } from './agenda-overdue.service';
import { AgendaService } from './agenda.service';
import { InstallmentReminderService } from './installment-reminders.service';

/**
 * Módulo Agenda (F10) — gestiones agendadas por fecha. Importa `ClientsModule` para reusar
 * `ClientsService.findOne(id, true)` (PII en claro + audit `PII_REVEAL`) en el alta. Completar/editar/eliminar → S4–S6.
 */
@Module({
  imports: [AuthModule, AuditModule, ClientsModule, NotificationsModule],
  controllers: [AgendaController],
  providers: [AgendaService, InstallmentReminderService, AgendaOverdueService],
  exports: [AgendaService],
})
export class AgendaModule {}
