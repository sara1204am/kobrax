import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';
import { UsersService } from './users.service';

/** Miembros del tenant, perfil propio y catálogo de roles (CUENTA · S0). */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UsersController, RolesController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
