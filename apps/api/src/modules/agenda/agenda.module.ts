import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { ClientsModule } from '../clients/clients.module';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

/**
 * Módulo Agenda (F10) — gestiones agendadas por fecha. Importa `ClientsModule` para reusar
 * `ClientsService.findOne(id, true)` (PII en claro + audit `PII_REVEAL`) en el alta. Completar/editar/eliminar → S4–S6.
 */
@Module({
  imports: [AuthModule, AuditModule, ClientsModule],
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
