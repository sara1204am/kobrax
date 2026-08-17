import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CasesService } from './cases.service';
import {
  AssignCaseDto,
  CloseCaseDto,
  CreateActivityDto,
  CreateCaseDto,
  GenerateCasesDto,
  ListCasesQueryDto,
  SetPriorityDto,
  TransitionCaseDto,
} from './dto/case.dto';

@Controller('cases')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Post()
  @Roles(Permission.CASE_WRITE)
  create(@Body() dto: CreateCaseDto) {
    return this.cases.create(dto);
  }

  @Post('generate')
  @Roles(Permission.CASE_ASSIGN)
  generate(@Body() dto: GenerateCasesDto) {
    return this.cases.generate(dto);
  }

  @Get()
  @Roles(Permission.CASE_READ)
  list(@Query() query: ListCasesQueryDto) {
    return this.cases.list(query);
  }

  @Get(':id')
  @Roles(Permission.CASE_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.cases.findOne(id);
  }

  @Patch(':id')
  @Roles(Permission.CASE_WRITE)
  transition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionCaseDto) {
    return this.cases.transition(id, dto);
  }

  @Post(':id/assign')
  @Roles(Permission.CASE_ASSIGN)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignCaseDto) {
    return this.cases.assign(id, dto);
  }

  /**
   * Subir o bajar la prioridad a mano, o devolverla a la automática.
   *
   * `CASE_WRITE` y no `CASE_ASSIGN`: decir «a éste hay que ir hoy» es parte de gestionar la cobranza,
   * no de repartirla — el cobrador que conoce a su deudor tiene que poder hacerlo sin ser supervisor.
   */
  @Post(':id/priority')
  @Roles(Permission.CASE_WRITE)
  setPriority(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPriorityDto) {
    return this.cases.setPriority(id, dto);
  }

  @Post(':id/activities')
  @Roles(Permission.CASE_WRITE)
  addActivity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateActivityDto) {
    return this.cases.addActivity(id, dto);
  }

  @Post(':id/close')
  @Roles(Permission.CASE_CLOSE)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseCaseDto) {
    return this.cases.close(id, dto.reason);
  }
}
