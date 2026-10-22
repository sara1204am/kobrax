import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { MailModule } from '../../common/mail/mail.module';
import { PlanModule } from '../../common/plan/plan.module';
import { AccountActivityService } from './account-activity.service';
import { AccountRequestsService } from './account-requests.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

/** Datos del propio tenant (CUENTA · S0). Prisma/TenantContext desde sus módulos `@Global`. */
@Module({
  imports: [AuthModule, AuditModule, PlanModule, MailModule],
  controllers: [AccountsController],
  providers: [AccountsService, AccountActivityService, AccountRequestsService],
  exports: [AccountsService, AccountRequestsService],
})
export class AccountsModule {}
