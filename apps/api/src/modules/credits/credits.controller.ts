import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditsService } from './credits.service';
import {
  ClearArrearsDto,
  CreateCreditDto,
  ListCreditsQueryDto,
  MarkArrearsDto,
  RecalcArrearsDto,
  UpdateCreditDto,
} from './dto/credit.dto';

@Controller('credits')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Post()
  @Roles(Permission.CREDIT_WRITE)
  create(@Body() dto: CreateCreditDto) {
    return this.credits.create(dto);
  }

  @Get()
  @Roles(Permission.CREDIT_READ)
  list(@Query() query: ListCreditsQueryDto) {
    return this.credits.list(query);
  }

  @Get(':id')
  @Roles(Permission.CREDIT_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.credits.findOne(id);
  }

  @Get(':id/schedule')
  @Roles(Permission.CREDIT_READ)
  schedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.credits.getSchedule(id);
  }

  @Patch(':id')
  @Roles(Permission.CREDIT_WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCreditDto) {
    return this.credits.update(id, dto);
  }

  @Post(':id/recalculate-arrears')
  @Roles(Permission.CREDIT_WRITE)
  recalculateArrears(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecalcArrearsDto) {
    return this.credits.recalculateArrears(id, dto.asOf);
  }

  /**
   * «Está en mora», dicho a mano — y el caso se abre en el acto, sin esperar al trabajo diario.
   * Para quien presta sin cronograma y sabe que le deben sin mirar una fecha.
   */
  @Post(':id/arrears')
  @Roles(Permission.CREDIT_WRITE)
  markArrears(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkArrearsDto) {
    return this.credits.markArrears(id, dto.days);
  }

  /** Poner al día: mueve la fecha de vencimiento y cierra el caso. No borra el síntoma. */
  @Post(':id/arrears/clear')
  @Roles(Permission.CREDIT_WRITE)
  clearArrears(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ClearArrearsDto) {
    return this.credits.clearArrears(id, dto);
  }
}
