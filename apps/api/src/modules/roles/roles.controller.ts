import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CompareRolesQuery, ListRolesQuery, RestoreRoleTemplateDto, RoleHistoryQuery, UpdateRolePermissionsDto } from './dto/roles.dto';
import { RolesService } from './roles.service';

/**
 * El recurso `/roles` (F14 · F7, D-1): lo MISMO para web y móvil.
 *
 * - `GET /roles` (sin parámetros) es el contrato histórico: los roles que quien pregunta puede asignar, `{ id, name, level }`.
 * - `GET /roles?assignable=false` es la vista del administrador (todos los roles de la cuenta, con detalle).
 * - El resto cuelga del mismo recurso. `permissions` y `compare` van ANTES de `:key`.
 * Lectura pide `role:read`; escritura, `role:write` y además la política `role.editPermissions`.
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Roles(Permission.ROLE_READ)
  list(@Query() query: ListRolesQuery) {
    return query.assignable === false ? this.roles.listAll() : this.roles.assignable();
  }

  @Get('permissions')
  @Roles(Permission.ROLE_READ)
  catalog() {
    return this.roles.catalog();
  }

  @Get('compare')
  @Roles(Permission.ROLE_READ)
  compare(@Query() query: CompareRolesQuery) {
    return this.roles.compare(query.a, query.b);
  }

  @Get(':key')
  @Roles(Permission.ROLE_READ)
  detail(@Param('key') key: string) {
    return this.roles.detail(key);
  }

  @Get(':key/history')
  @Roles(Permission.ROLE_READ)
  history(@Param('key') key: string, @Query() query: RoleHistoryQuery) {
    return this.roles.history(key, query.cursor, query.limit);
  }

  @Put(':key/permissions')
  @Roles(Permission.ROLE_WRITE)
  update(@Param('key') key: string, @Body() dto: UpdateRolePermissionsDto) {
    return this.roles.updatePermissions(key, dto);
  }

  @Post(':key/restore-template')
  @HttpCode(200)
  @Roles(Permission.ROLE_WRITE)
  restore(@Param('key') key: string, @Body() dto: RestoreRoleTemplateDto) {
    return this.roles.restoreTemplate(key, dto);
  }
}
