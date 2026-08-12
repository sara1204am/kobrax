import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FieldService } from './field.service';
import { AddEvidenceDto, CreateVisitDto, ListVisitsQueryDto } from './dto/field.dto';

@Controller('visits')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class FieldController {
  constructor(private readonly field: FieldService) {}

  /**
   * Las visitas registradas (F9 W6-T0). `ROUTE_READ` y no `ROUTE_EXECUTE`: **leer no es ejecutar**,
   * y quien supervisa desde la oficina no sale a la calle. El alcance —todo el tenant o sólo lo
   * propio— lo decide el service por capacidad, como en rutas.
   */
  @Get()
  @Roles(Permission.ROUTE_READ)
  list(@Query() query: ListVisitsQueryDto) {
    return this.field.list(query);
  }

  /** Una visita con sus evidencias: la foto, el punto y el hash que la sellan. */
  @Get(':id')
  @Roles(Permission.ROUTE_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.field.findOne(id);
  }

  @Post()
  @Roles(Permission.ROUTE_EXECUTE)
  createVisit(@Body() dto: CreateVisitDto) {
    return this.field.createVisit(dto);
  }

  @Post(':id/evidence')
  @Roles(Permission.ROUTE_EXECUTE)
  addEvidence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddEvidenceDto) {
    return this.field.addEvidence(id, dto);
  }
}
