import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UpdateLocationDto } from '../clients/dto/client.dto';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AgendaService } from './agenda.service';
import {
  AddClientContactDto,
  AddClientLocationDto,
  CancelAgendaItemDto,
  CompleteAgendaItemDto,
  CreateAgendaItemDto,
  ListAgendaQueryDto,
  ListOverdueQueryDto,
  PostponeAgendaItemDto,
  RescheduleAgendaItemDto,
  UpdateAgendaItemDto,
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

  /** Corrige una dirección ya cargada (marcarle el punto a una importada). Mismo scope que el alta. */
  @Patch('clients/:clientId/locations/:locationId')
  @Roles(Permission.AGENDA_WRITE)
  updateClientLocation(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.agenda.updateClientLocation(clientId, locationId, dto);
  }

  @Get()
  @Roles(Permission.AGENDA_READ)
  list(@Query() query: ListAgendaQueryDto) {
    return this.agenda.listByDay(query);
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

  /** Registrar la ejecución de la gestión (S4): deja un CaseActivity y pasa el agendado a EXECUTED. */
  @Post(':id/complete')
  @Roles(Permission.AGENDA_WRITE)
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteAgendaItemDto) {
    return this.agenda.complete(id, dto);
  }

  /** Posponer la gestión en pasos fijos (+15 / +30 / +1h); sigue pendiente. */
  @Post(':id/postpone')
  @Roles(Permission.AGENDA_WRITE)
  postpone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PostponeAgendaItemDto) {
    return this.agenda.postpone(id, dto);
  }

  /** Editar una gestión pendiente (S5). Sin fecha ni deudor: eso es reagendar y dar de alta. */
  @Patch(':id')
  @Roles(Permission.AGENDA_WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgendaItemDto) {
    return this.agenda.update(id, dto);
  }

  /** Cancelar con motivo del catálogo (S6): sigue visible, con estado Cancelada. */
  @Post(':id/cancel')
  @Roles(Permission.AGENDA_WRITE)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelAgendaItemDto) {
    return this.agenda.cancel(id, dto);
  }

  /** Reagendar a otro día (S6): cierra ésta como Reagendada y devuelve la nueva. */
  @Post(':id/reschedule')
  @Roles(Permission.AGENDA_WRITE)
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleAgendaItemDto) {
    return this.agenda.reschedule(id, dto);
  }

  /** Eliminar (soft-delete) una gestión cargada por error (S6). Responde 200 con el ítem, no 204. */
  @Delete(':id')
  @Roles(Permission.AGENDA_WRITE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.agenda.remove(id);
  }
}
