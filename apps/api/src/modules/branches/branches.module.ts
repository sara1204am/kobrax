import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PlanModule } from '../../common/plan/plan.module';
import { BranchesController, BranchTypesController } from './branches.controller';
import { BranchesService } from './branches.service';

/** Oficinas de la cuenta en árbol (F13). Prisma/TenantContext desde sus módulos `@Global`; el tope de oficinas viene del plan. */
@Module({
  imports: [AuthModule, AuditModule, PlanModule],
  controllers: [BranchesController, BranchTypesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
