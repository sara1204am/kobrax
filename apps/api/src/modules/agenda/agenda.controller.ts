import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AgendaService } from './agenda.service';
import {
  AddClientContactDto,
  AddClientLocationDto,
  CreateAgendaItemDto,
  ListAgendaQueryDto,
  ListOverdueQueryDto,
} from './dto/agenda.dto';

@Controller('agenda')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('overdue')
  @Roles(Permission.AGENDA_READ)
  overdue(@Query() query: ListOverdueQueryDto) {
    return this.agenda.listOverdue(query);
  }

  /**
   * Contexto para agendarle a un cliente: sus créditos con caso abierto + teléfonos y direcciones
   * **en claro**. Revela PII (auditada) → exige `AGENDA_WRITE`, no `AGENDA_READ`.
   */
  @Get('clients/:clientId/context')
  @Roles(Permission.AGENDA_WRITE)
  clientContext(@Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.agenda.clientContext(clientId);
  }

  /**
   * Carga un teléfono que el cliente no tenía, desde el formulario de agendar. `AGENDA_WRITE` (no
   * `CLIENT_WRITE`): el cobrador no administra clientes, pero sí necesita el número al que va a llamar.
   */
  @Post('clients/:clientId/contacts')
  @Roles(Permission.AGENDA_WRITE)
  addClientContact(@Param('clientId', ParseUUIDPipe) clientId: string, @Body() dto: AddClientContactDto) {
    return this.agenda.addClientContact(clientId, dto);
  }

  /** Ídem, para la dirección de una visita a un domicilio que el cliente no tenía cargado. */
  @Post('clients/:clientId/locations')
  @Roles(Permission.AGENDA_WRITE)
  addClientLocation(@Param('clientId', ParseUUIDPipe) clientId: string, @Body() dto: AddClientLocationDto) {
    return this.agenda.addClientLocation(clientId, dto);
  }

  @Get()
  @Roles(Permission.AGENDA_READ)
  list(@Query() query: ListAgendaQueryDto) {
    return this.agenda.listByDay(query.date);
  }

  @Post()
  @Roles(Permission.AGENDA_WRITE)
  create(@Body() dto: CreateAgendaItemDto) {
    return this.agenda.create(dto);
  }

  /**
   * Detalle de una gestión (S3). **Va último a propósito**: declarado antes que `overdue` o
   * `clients/:id/context`, el `ParseUUIDPipe` de `:id` se comería esas rutas con un 400.
   */
  @Get(':id')
  @Roles(Permission.AGENDA_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.agenda.findOne(id);
  }
}
