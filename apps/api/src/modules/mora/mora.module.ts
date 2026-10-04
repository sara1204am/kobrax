import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { AgendaModule } from '../agenda/agenda.module';
import { ArrearsModule } from '../arrears/arrears.module';
import { CasesModule } from '../cases/cases.module';
import { MoraController } from './mora.controller';
import { MoraExportService } from './mora-export.service';
import { MoraService } from './mora.service';

/**
 * Central de Mora (F4/07). Prisma y TenantContext vienen de sus módulos `@Global`. `AgendaModule` aporta la única
 * creación de promesas; `ArrearsModule`, la prioridad del episodio. `CasesModule` sigue por `byCase` (hasta la fase 6).
 */
@Module({
  imports: [AuthModule, AuditModule, CasesModule, AgendaModule, ArrearsModule],
  controllers: [MoraController],
  providers: [MoraService, MoraExportService],
})
export class MoraModule {}
