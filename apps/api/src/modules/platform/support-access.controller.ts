import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Permission, ResponseDto } from '@kobrax/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { Authenticated } from '../auth/decorators/authz.decorator';
import { SupportSessionsService } from './support-sessions.service';

/**
 * F14 · F5 (H-11): el lado de la CUENTA. El administrador ve los accesos de soporte de su empresa, acepta o rechaza la escritura sensible y puede revocar
 * cualquier acceso en cualquier momento. Exige `support:consent` (los administradores).
 */
@Controller('support-access')
export class SupportAccessController {
  constructor(private readonly sessions: SupportSessionsService) {}

  @Get()
  @Roles(Permission.SUPPORT_CONSENT)
  async list() {
    return ResponseDto.ok(await this.sessions.list());
  }

  /** La sesión de soporte con la que se está entrando ahora (null si es un usuario de la empresa): para el aviso del panel. */
  @Get('current')
  @Authenticated()
  async current() {
    return ResponseDto.ok(await this.sessions.current());
  }

  @Post(':id/grant')
  @HttpCode(200)
  @Roles(Permission.SUPPORT_CONSENT)
  async grant(@Param('id', ParseUUIDPipe) id: string) {
    return ResponseDto.ok(await this.sessions.decide(id, 'GRANTED'));
  }

  @Post(':id/deny')
  @HttpCode(200)
  @Roles(Permission.SUPPORT_CONSENT)
  async deny(@Param('id', ParseUUIDPipe) id: string) {
    return ResponseDto.ok(await this.sessions.decide(id, 'DENIED'));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Roles(Permission.SUPPORT_CONSENT)
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    return ResponseDto.ok(await this.sessions.revoke(id));
  }
}
