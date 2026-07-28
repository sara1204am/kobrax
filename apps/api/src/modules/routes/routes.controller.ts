import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoutesService } from './routes.service';
import { CreateRouteDto, GenerateRouteDto, ListRoutesQueryDto, UpdateRouteDto, UpdateStopDto } from './dto/route.dto';

@Controller('routes')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Post()
  @Roles(Permission.ROUTE_WRITE)
  create(@Body() dto: CreateRouteDto) {
    return this.routes.create(dto);
  }

  // Puerta mínima: quién genera y PARA QUIÉN lo decide el service por capacidad
  // (ROUTE_ASSIGN = para cualquiera; ROUTE_EXECUTE = sólo la propia; ninguna = 403).
  @Post('generate')
  @Roles(Permission.ROUTE_READ)
  generate(@Body() dto: GenerateRouteDto) {
    return this.routes.generate(dto);
  }

  @Get()
  @Roles(Permission.ROUTE_READ)
  list(@Query() query: ListRoutesQueryDto) {
    return this.routes.list(query);
  }

  @Get(':id')
  @Roles(Permission.ROUTE_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.routes.findOne(id);
  }

  // Igual que `generate`: la puerta es mínima y el service decide sobre QUÉ ruta puede cada capacidad.
  @Patch(':id')
  @Roles(Permission.ROUTE_READ)
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRouteDto) {
    return this.routes.updateStatus(id, dto);
  }

  @Patch(':id/stops/:sid')
  @Roles(Permission.ROUTE_EXECUTE)
  updateStop(@Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string, @Body() dto: UpdateStopDto) {
    return this.routes.updateStop(id, sid, dto);
  }
}
