import { Controller, Get, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';

/** Vive en el módulo `users`: un controller de un endpoint no justifica un módulo propio. */
@Controller('roles')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Permission.ROLE_READ)
  list() {
    return this.users.listRoles();
  }
}
