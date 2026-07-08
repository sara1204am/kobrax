import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

/** Módulo Agenda (F10) — gestiones agendadas por fecha. Escritura llega en S2–S6. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
