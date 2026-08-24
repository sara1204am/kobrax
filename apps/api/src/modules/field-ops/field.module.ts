import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PlanModule } from '../../common/plan/plan.module';
import { MailModule } from '../../common/mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlanUsageAlertsService } from '../../common/plan/plan-usage-alerts.service';
import { FieldController } from './field.controller';
import { FieldService } from './field.service';

/**
 * Módulo de operación en campo (RF-08, CU-04 backend): visitas + evidencia sellada.
 *
 * `PlanModule` entra para **contar y avisar** (L2), nunca para frenar: `assertRoom` no se llama
 * acá, y el tipo `MonthlyCounter` hace que no se pueda. El aviso vive en `PlanUsageAlertsService`
 * y se provee acá porque éste es el único módulo que registra fotos y gestiones.
 */
@Module({
  imports: [AuthModule, AuditModule, PlanModule, MailModule, NotificationsModule],
  controllers: [FieldController],
  providers: [FieldService, PlanUsageAlertsService],
})
export class FieldModule {}
