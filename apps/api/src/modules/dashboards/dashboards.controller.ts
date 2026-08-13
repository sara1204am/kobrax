import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardsService } from './dashboards.service';
import { CreateDashboardDto, UpdateDashboardDto } from './dto/dashboard.dto';

/**
 * Los tableros configurables (W8).
 *
 * Todo pide `report:read` —la misma audiencia que ve el dashboard— y **quién puede modificar cuál
 * lo decide el service**: el que lo creó, o el admin de la cuenta. Un permiso nuevo para esto
 * sería otro concepto que administrar por una regla que se explica en una línea.
 */
@Controller('dashboards')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Permission.REPORT_READ)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  list() {
    return this.dashboards.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboards.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDashboardDto) {
    return this.dashboards.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDashboardDto) {
    return this.dashboards.update(id, dto);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboards.duplicate(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboards.remove(id);
  }
}
