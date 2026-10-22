import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

/** Agencias de la cuenta (Refactor de Cuenta · F6). Prisma/TenantContext desde sus módulos `@Global`. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
