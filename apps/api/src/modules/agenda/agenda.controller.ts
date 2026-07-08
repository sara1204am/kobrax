import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AgendaService } from './agenda.service';
import { ListAgendaQueryDto, ListOverdueQueryDto } from './dto/agenda.dto';

@Controller('agenda')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('overdue')
  @Roles(Permission.AGENDA_READ)
  overdue(@Query() query: ListOverdueQueryDto) {
    return this.agenda.listOverdue(query);
  }

  @Get()
  @Roles(Permission.AGENDA_READ)
  list(@Query() query: ListAgendaQueryDto) {
    return this.agenda.listByDay(query.date);
  }
}
