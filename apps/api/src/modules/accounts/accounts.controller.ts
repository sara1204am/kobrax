import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AccountsService } from './accounts.service';
import { UpdateAccountDto } from './dto/account.dto';

@Controller('accounts')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('me')
  @Roles(Permission.ACCOUNT_READ)
  findMine() {
    return this.accounts.findMine();
  }

  @Patch('me')
  @Roles(Permission.ACCOUNT_WRITE)
  update(@Body() dto: UpdateAccountDto) {
    return this.accounts.update(dto);
  }
}
