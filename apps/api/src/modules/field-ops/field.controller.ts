import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FieldService } from './field.service';
import { AddEvidenceDto, CreateVisitDto } from './dto/field.dto';

@Controller('visits')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class FieldController {
  constructor(private readonly field: FieldService) {}

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
