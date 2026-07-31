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

  /** Registro público (S4). Sin guards a propósito; la guarda es el DTO + el rate limit. */
  @Post()
  @RateLimit({ limit: 3, windowSec: 3600, by: 'ip' })
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
