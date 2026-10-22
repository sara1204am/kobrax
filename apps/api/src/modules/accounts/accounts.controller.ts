import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AccountActivityService } from './account-activity.service';
import { AccountRequestsService } from './account-requests.service';
import { AccountsService } from './accounts.service';
import { UpdateAccountDto } from './dto/account.dto';
import { CreateAccountRequestDto } from './dto/account-request.dto';
import { CreateAccountDto } from './dto/create-account.dto';

/**
 * Los guards van **por método**, no en la clase: el registro (S4) es público y
 * convive con las lecturas/escrituras autenticadas del mismo recurso (S4-D3).
 */
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly activity: AccountActivityService,
    private readonly requests: AccountRequestsService,
  ) {}

  /**
   * Registro público (S4). Sin guards a propósito; la guarda es el DTO + el rate limit.
   *
   * 10/hora y no 3: **una IP no es una persona.** Detrás de un NAT de oficina —o de un
   * `adb reverse`, donde todo el teléfono sale como 127.0.0.1— varios usuarios legítimos
   * comparten IP y se bloquean entre ellos. Diez sigue haciendo inviable el alta masiva de
   * tenants, que es el riesgo real (README R1); contra el duplicado ya está el `@unique`.
   */
  @Post()
  @RateLimit({ limit: 10, windowSec: 3600, by: 'ip' })
  create(@Body() dto: CreateAccountDto, @Req() req: Request) {
    return this.accounts.create(dto, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Permission.ACCOUNT_READ)
  findMine() {
    return this.accounts.findMine();
  }

  /**
   * Qué se cambió en la cuenta y quién lo hizo. Pide `audit:read` porque el registro trae IPs y cambios de seguridad.
   * `before` es el cursor de la página anterior; `entity` filtra por tipo de cambio.
   */
  @Get('me/activity')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Permission.AUDIT_READ)
  activityPage(@Query('before') before?: string, @Query('limit') limit?: string, @Query('entity') entity?: string, @Query('userId') userId?: string) {
    return this.activity.activity({ before, limit: limit === undefined ? undefined : Number(limit), entity, userId });
  }

  /** Los cambios de plan y de estado que hizo Kobrax: la parte de «Facturación» que la cuenta puede leer. */
  @Get('me/plan-history')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Permission.ACCOUNT_READ)
  planHistory() {
    return this.activity.planHistory();
  }

  @Get('me/requests')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Permission.ACCOUNT_READ)
  listRequests() {
    return this.requests.list();
  }

  /** Pide algo a Kobrax (cambio de plan, baja). No cambia nada por sí solo: queda registrado y se avisa al equipo. */
  @Post('me/requests')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Permission.ACCOUNT_WRITE)
  @RateLimit({ limit: 10, windowSec: 3600, by: 'ip' })
  createRequest(@Body() dto: CreateAccountRequestDto) {
    return this.requests.create(dto);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Permission.ACCOUNT_WRITE)
  update(@Body() dto: UpdateAccountDto) {
    return this.accounts.update(dto);
  }
}
