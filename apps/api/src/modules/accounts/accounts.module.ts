import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

/** Datos del propio tenant (CUENTA · S0). Prisma/TenantContext desde sus módulos `@Global`. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
