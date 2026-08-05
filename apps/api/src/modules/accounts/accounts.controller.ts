import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AccountsService } from './accounts.service';
import { UpdateAccountDto } from './dto/account.dto';
import { CreateAccountDto } from './dto/create-account.dto';

/**
 * Los guards van **por método**, no en la clase: el registro (S4) es público y
 * convive con las lecturas/escrituras autenticadas del mismo recurso (S4-D3).
 */
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

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

  @Patch('me')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Permission.ACCOUNT_WRITE)
  update(@Body() dto: UpdateAccountDto) {
    return this.accounts.update(dto);
  }
}
