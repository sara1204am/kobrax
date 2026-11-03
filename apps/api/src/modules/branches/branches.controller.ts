import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchesService } from './branches.service';
import { AssignMembersDto, CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

/** Agencias de la cuenta. Leer: quien ve el equipo (`user:read`). Escribir: quien administra la cuenta (`account:write`). */
@Controller('branches')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @Roles(Permission.USER_READ)
  list() {
    return this.branches.list();
  }

  @Post()
  @Roles(Permission.ACCOUNT_WRITE)
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Patch(':id')
  @Roles(Permission.ACCOUNT_WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Permission.ACCOUNT_WRITE)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.branches.remove(id);
  }

  /** Pasa a estas personas a la agencia. Quitar a alguien de una agencia es `PATCH /users/:id` con `branchId: null`. */
  @Post(':id/members')
  @Roles(Permission.ACCOUNT_WRITE)
  assignMembers(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignMembersDto) {
    return this.branches.assignMembers(id, dto);
  }
}
