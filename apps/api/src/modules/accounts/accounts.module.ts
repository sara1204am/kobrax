import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PlanModule } from '../../common/plan/plan.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

/** Datos del propio tenant (CUENTA · S0). Prisma/TenantContext desde sus módulos `@Global`. */
@Module({
  imports: [AuthModule, AuditModule, PlanModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
