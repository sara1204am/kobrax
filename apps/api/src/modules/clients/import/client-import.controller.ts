import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard, type AuthenticatedUser } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ClientImportService } from './client-import.service';
import { ImportClientsDto } from './import.dto';

@Controller('clients/imports')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ClientImportController {
  constructor(private readonly imports: ClientImportService) {}

  /**
   * El import de CLIENTES (anterior al de cartera, sin pantalla hoy). Pide además `client:write`
   * (P11): da de alta y actualiza clientes en bloque, y el supervisor —que importa cartera desde el
   * 2026-09-30— nunca pudo escribir clientes. Sin esto, darle `client:import` le abría esta puerta.
   */
  @Post()
  @Roles(Permission.CLIENT_IMPORT, Permission.CLIENT_WRITE)
  run(@Body() dto: ImportClientsDto, @CurrentUser() user: AuthenticatedUser) {
    // El modo destructivo REPLACE exige un permiso elevado adicional.
    if (dto.mode === 'REPLACE' && !user.permissions.includes(Permission.CLIENT_IMPORT_REPLACE)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSION',
        message: 'El modo REPLACE requiere el permiso client:import:replace',
      });
    }
    return this.imports.run(dto);
  }
}
