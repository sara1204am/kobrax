import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoutesService } from './routes.service';
import { RouteChangesService } from './route-changes.service';
import { buildRoutePdf } from './route-pdf';
import {
  AddStopDto,
  CreateChangeRequestDto,
  CreateRouteDto,
  DecideChangeRequestDto,
  GenerateRouteDto,
  ListRoutesQueryDto,
  PlanPreviewDto,
  UpdateRouteDto,
  UpdateStopDto,
} from './dto/route.dto';

@Controller('routes')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class RoutesController {
  constructor(
    private readonly routes: RoutesService,
    private readonly changes: RouteChangesService,
  ) {}

  // Puerta mínima, igual que `generate`: el cobrador arma SU ruta desde el mapa (RT-1) y no tiene
  // ROUTE_WRITE — con esa puerta el flujo entero moría en 403. Para quién es la ruta lo decide
  // `collectorFor` en el service, que ya 403ea a quien no ejecuta ni asigna.
  @Post()
  @Roles(Permission.ROUTE_READ)
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

  /** La vista previa de un recorrido que todavía no se publicó (F4/12): no guarda nada. */
  @Post('plan-preview')
  @Roles(Permission.ROUTE_READ)
  planPreview(@Body() dto: PlanPreviewDto) {
    return this.routes.previewPoints(dto);
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

  /** La hoja de ruta impresa: mismas paradas que `findOne` (ya revelado y auditado), en PDF. */
  @Get(':id/pdf')
  @Roles(Permission.ROUTE_READ)
  async pdf(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { route, ...ctx } = await this.routes.pdfBundle(id);
    const buffer = await buildRoutePdf(route, ctx);
    return new StreamableFile(buffer, { type: 'application/pdf', disposition: 'attachment; filename="hoja-de-ruta.pdf"' });
  }

  /** Vista previa (S3): la polilínea por las calles, distancia, duración y el orden sugerido. */
  @Get(':id/preview')
  @Roles(Permission.ROUTE_READ)
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.routes.preview(id);
  }

  /** Aplica el orden sugerido por el preview. Puerta mínima + scope en el service, como las paradas. */
  @Post(':id/optimize')
  @Roles(Permission.ROUTE_READ)
  optimize(@Param('id', ParseUUIDPipe) id: string) {
    return this.routes.optimize(id);
  }

  @Post(':id/stops')
  @Roles(Permission.ROUTE_READ)
  addStop(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddStopDto) {
    return this.routes.addStop(id, dto);
  }

  @Delete(':id/stops/:sid')
  @HttpCode(204)
  @Roles(Permission.ROUTE_READ)
  removeStop(@Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string) {
    return this.routes.removeStop(id, sid);
  }

  @Patch(':id/stops/:sid')
  @Roles(Permission.ROUTE_READ)
  updateStop(@Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string, @Body() dto: UpdateStopDto) {
    return this.routes.updateStop(id, sid, dto);
  }

  // ── Pedidos de cambio (F4/12): quien no armó la ruta la pide, quien la armó aprueba o rechaza ──────────────────
  // Puerta mínima + alcance y autoría en el service, como el resto de las rutas.

  @Post(':id/change-requests')
  @Roles(Permission.ROUTE_READ)
  requestChange(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateChangeRequestDto) {
    return this.changes.create(id, dto);
  }

  @Get(':id/change-requests')
  @Roles(Permission.ROUTE_READ)
  listChanges(@Param('id', ParseUUIDPipe) id: string) {
    return this.changes.list(id);
  }

  @Patch(':id/change-requests/:rid')
  @Roles(Permission.ROUTE_READ)
  decideChange(@Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() dto: DecideChangeRequestDto) {
    return this.changes.decide(id, rid, dto);
  }
}
