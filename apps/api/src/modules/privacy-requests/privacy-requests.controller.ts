import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Permission, PlatformPermission, PrivacyRequestStatus, ResponseDto } from '@kobrax/shared';
import { Authenticated, Authz, Public } from '../auth/decorators/authz.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/guards/jwt-auth.guard';
import { CreateOrgPrivacyRequestDto, CreateOwnPrivacyRequestDto, TransitionPrivacyRequestDto } from './dto/privacy-requests.dto';
import { ConfirmPublicReportDto, CreatePublicReportDto } from './dto/public-report.dto';
import { PrivacyRequestsService } from './privacy-requests.service';

/**
 * Solicitudes de derechos (privacidad · B6).
 *  - `mine` / `POST /`: la propia persona sobre sus datos (sin permiso: la persona sale de la sesión).
 *  - `org/*`: el personal de una organización registra y da seguimiento a solicitudes de titulares de cobranza (`account:write`).
 */
@Controller('privacy/requests')
export class PrivacyRequestsController {
  constructor(private readonly requests: PrivacyRequestsService) {}

  @Get('mine')
  @Authenticated()
  mine() {
    return this.requests.listOwn();
  }

  @Post()
  @Authenticated()
  create(@Body() dto: CreateOwnPrivacyRequestDto) {
    return this.requests.fileOwn(dto);
  }

  @Get('org')
  @Roles(Permission.ACCOUNT_WRITE)
  org() {
    return this.requests.listOrg();
  }

  @Post('org')
  @Roles(Permission.ACCOUNT_WRITE)
  createOrg(@Body() dto: CreateOrgPrivacyRequestDto) {
    return this.requests.fileOrg(dto);
  }

  @Patch('org/:id/status')
  @Roles(Permission.ACCOUNT_WRITE)
  transitionOrg(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionPrivacyRequestDto) {
    return this.requests.transitionOrg(id, dto);
  }
}

/** Lo que hace la PERSONA DE PLATAFORMA: atender las solicitudes de las personas usuarias de Kobrax (`APP_USER`). */
@Controller('platform/privacy-requests')
export class PrivacyPlatformController {
  constructor(private readonly requests: PrivacyRequestsService) {}

  private platformUserId(req: Request): string {
    return (req as Request & { user: AuthenticatedUser }).user.userId;
  }

  @Get()
  @Authz({ all: [PlatformPermission.PRIVACY_MANAGE] })
  async list(@Query('status') status?: string) {
    const s = status && (Object.values(PrivacyRequestStatus) as string[]).includes(status) ? (status as PrivacyRequestStatus) : undefined;
    return ResponseDto.ok(await this.requests.listPlatform(s));
  }

  @Patch(':id/status')
  @Authz({ all: [PlatformPermission.PRIVACY_MANAGE] })
  async transition(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionPrivacyRequestDto) {
    return ResponseDto.ok(await this.requests.transitionPlatform(id, dto, this.platformUserId(req)));
  }
}

/**
 * El formulario público (`/reportar`): una persona SIN cuenta —un deudor, un tercero— reporta hostigamiento o datos cargados sin derecho, o
 * pide corrección o eliminación. `@Public()` porque no hay sesión; la guarda es el DTO, la trampa `website` y el límite de peticiones.
 * 5 por hora y por IP: alcanza para una persona real (hasta detrás de un NAT) y vuelve inviable inundar la bandeja de la plataforma.
 */
@Controller('public/reports')
export class PublicReportsController {
  constructor(private readonly requests: PrivacyRequestsService) {}

  @Post()
  @Public()
  @RateLimit({ limit: 5, windowSec: 3600, by: 'ip' })
  async create(@Body() dto: CreatePublicReportDto) {
    return ResponseDto.ok(await this.requests.filePublic(dto));
  }

  /**
   * La persona confirma que el correo es suyo (el enlace del correo abre `/verificar-reporte`, que llama aquí con un botón: un `GET` con efecto
   * lo dispararían solos los escáneres de enlaces del correo). 20 por hora y por IP: el token es de 256 bits, el límite solo frena el ruido.
   */
  @Post('confirm')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSec: 3600, by: 'ip' })
  async confirm(@Body() dto: ConfirmPublicReportDto) {
    return ResponseDto.ok(await this.requests.confirmPublic(dto.token));
  }
}
