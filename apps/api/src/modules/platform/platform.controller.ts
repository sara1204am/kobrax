import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformPermission, ResponseDto } from '@kobrax/shared';
import { Authz } from '../auth/decorators/authz.decorator';
import type { AuthenticatedUser } from '../auth/guards/jwt-auth.guard';
import { OpenSupportSessionDto } from './platform.dto';
import { SupportSessionsService } from './support-sessions.service';

/**
 * F14 · F5 (H-11): lo que hace la PERSONA DE PLATAFORMA con su token de plataforma (sin cuenta). Todo exige permisos `platform:*`, que ningún usuario
 * de empresa tiene. Entrar a una cuenta es siempre por una sesión de soporte: motivo, ticket, vencimiento y —para escritura sensible— el consentimiento
 * del administrador de la cuenta.
 */
@Controller('platform')
export class PlatformController {
  constructor(private readonly sessions: SupportSessionsService) {}

  private platformUserId(req: Request): string {
    return (req as Request & { user: AuthenticatedUser }).user.userId;
  }

  @Post('support-sessions')
  @Authz({ all: [PlatformPermission.SUPPORT_OPEN] })
  async open(@Req() req: Request, @Body() dto: OpenSupportSessionDto) {
    return ResponseDto.ok(await this.sessions.open(this.platformUserId(req), dto));
  }

  /** El token de acceso de una sesión vigente (se renueva pidiéndolo de nuevo: dura lo que el acceso, 15 minutos). */
  @Post('accounts/:accountId/support-sessions/:id/token')
  @HttpCode(200)
  @Authz({ all: [PlatformPermission.SUPPORT_OPEN] })
  async token(@Req() req: Request, @Param('accountId', ParseUUIDPipe) accountId: string, @Param('id', ParseUUIDPipe) id: string) {
    return ResponseDto.ok(await this.sessions.issueToken(this.platformUserId(req), accountId, id));
  }

  @Get('accounts/:accountId/support-sessions')
  @Authz({ all: [PlatformPermission.ACCOUNTS_READ] })
  async list(@Param('accountId', ParseUUIDPipe) accountId: string) {
    return ResponseDto.ok(await this.sessions.listForAccount(accountId));
  }
}
