import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

/** Módulo de casos de cobranza (CU-03). EventBus/TenantContext/Prisma desde sus módulos `@Global`. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
