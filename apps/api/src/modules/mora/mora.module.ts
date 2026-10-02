import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { CasesModule } from '../cases/cases.module';
import { MoraController } from './mora.controller';
import { MoraExportService } from './mora-export.service';
import { MoraService } from './mora.service';

/** Central de Mora (F4/07). Prisma y TenantContext vienen de sus módulos `@Global`. */
@Module({
  imports: [AuthModule, AuditModule, CasesModule],
  controllers: [MoraController],
  providers: [MoraService, MoraExportService],
})
export class MoraModule {}
