import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardsService } from './dashboards.service';
import { CreateDashboardDto, UpdateDashboardDto } from './dto/dashboard.dto';

/**
 * Los tableros configurables (W8).
 *
 * Todo pide `report:read` —la misma audiencia que ve el dashboard—. Los tableros son **de cada persona**: el service
 * filtra por dueño, así que cada quien sólo ve, crea y edita los suyos. Sin permiso nuevo: es una vista personal.
 */
@Controller('dashboards')
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
