import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/** Roles de la cuenta (F14 · F7): asignables para invitar y cambiar el rol, y el editor del administrador. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
