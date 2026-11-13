import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { AuditModule } from '../../common/audit/audit.module';
import { MailModule } from '../../common/mail/mail.module';
import { PlanModule } from '../../common/plan/plan.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MemberDetailService } from './member-detail.service';

/** Miembros del tenant y perfil propio (CUENTA · S0). Los roles viven en `RolesModule` (F14 · F7). */
@Module({
  imports: [AuthModule, AuditModule, MailModule, PlanModule, AssignmentsModule],
  controllers: [UsersController],
  providers: [UsersService, MemberDetailService],
  exports: [UsersService],
})
export class UsersModule {}
