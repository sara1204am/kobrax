import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformPermission, ResponseDto } from '@kobrax/shared';
import { Authz } from '../auth/decorators/authz.decorator';
import type { AuthenticatedUser } from '../auth/guards/jwt-auth.guard';
import { OpenSupportSessionDto, SetAccountStatusDto } from './platform.dto';
import { PlatformAccountsService } from './platform-accounts.service';
import { SupportSessionsService } from './support-sessions.service';

/**
 * F14 · F5 (H-11): lo que hace la PERSONA DE PLATAFORMA con su token de plataforma (sin cuenta). Todo exige permisos `platform:*`, que ningún usuario
 * de empresa tiene. Entrar a una cuenta es siempre por una sesión de soporte: motivo, ticket, vencimiento y —para escritura sensible— el consentimiento
 * del administrador de la cuenta.
 */
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly sessions: SupportSessionsService,
    private readonly accounts: PlatformAccountsService,
  ) {}

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

  /** Buscar cuentas (todas las empresas). Solo lo que identifica a la cuenta; nunca datos de cartera. */
  @Get('accounts')
  @Authz({ all: [PlatformPermission.ACCOUNTS_READ] })
  async listAccounts(@Query('q') q?: string) {
    return ResponseDto.ok(await this.accounts.list(q?.slice(0, 100)));
  }

  /** Suspender o reactivar una cuenta, con motivo. Corta el inicio de sesión de toda la cuenta; queda en su auditoría. */
  @Post('accounts/:accountId/status')
  @HttpCode(200)
  @Authz({ all: [PlatformPermission.ACCOUNTS_SUSPEND] })
  async setAccountStatus(@Req() req: Request, @Param('accountId', ParseUUIDPipe) accountId: string, @Body() dto: SetAccountStatusDto) {
    return ResponseDto.ok(await this.accounts.setStatus(accountId, dto.status, dto.reason, this.platformUserId(req)));
  }

  @Get('accounts/:accountId/support-sessions')
  @Authz({ all: [PlatformPermission.ACCOUNTS_READ] })
  async list(@Param('accountId', ParseUUIDPipe) accountId: string) {
    return ResponseDto.ok(await this.sessions.listForAccount(accountId));
  }
}
