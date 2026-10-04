import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateMoraActivityDto, CreateMoraNoteDto, ListMoraQueryDto, SetMoraPriorityDto, UpdateMoraNoteDto } from './dto/mora.dto';
import { MoraExportService } from './mora-export.service';
import { MoraService } from './mora.service';

/** Central de Mora: créditos en mora, una fila por crédito. */
@Controller('mora')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MoraController {
  constructor(
    private readonly mora: MoraService,
    private readonly exporter: MoraExportService,
  ) {}

  @Get()
  @Roles(Permission.COLLECTION_READ)
  list(@Query() query: ListMoraQueryDto) {
    return this.mora.list(query);
  }

  /**
   * Exportar lo que se está viendo: mismo filtro, orden y alcance que `GET /mora`.
   *
   * Exige `collection:export` **y** `collection:read`: se descarga lo que se podría mirar. No es `report:export`, que
   * abre los exports de toda la cuenta sin acotar por alcance. Van antes de `:creditId`.
   */
  @Get('export.csv')
  @Roles(Permission.COLLECTION_READ, Permission.COLLECTION_EXPORT)
  async exportCsv(@Query() query: ListMoraQueryDto): Promise<StreamableFile> {
    const file = await this.exporter.csv(query);
    return new StreamableFile(file.stream, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${file.filename}"` });
  }

  @Get('export.pdf')
  @Roles(Permission.COLLECTION_READ, Permission.COLLECTION_EXPORT)
  async exportPdf(@Query() query: ListMoraQueryDto): Promise<StreamableFile> {
    const file = await this.exporter.pdf(query);
    return new StreamableFile(file.content, { type: 'application/pdf', disposition: `attachment; filename="${file.filename}"` });
  }

  /** Las oficinas para el filtro. Va antes de `:creditId`. */
  @Get('branches')
  @Roles(Permission.COLLECTION_READ)
  branches() {
    return this.mora.branches();
  }

  /** Va antes de `:creditId`: «by-case» no es un id. */
  @Get('by-case/:caseId')
  @Roles(Permission.COLLECTION_READ)
  byCase(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.mora.byCase(caseId);
  }

  /** El historial de mora del crédito. Va antes de `:creditId` por el mismo motivo que `by-case`. */
  @Get(':creditId/episodes')
  @Roles(Permission.COLLECTION_READ)
  episodes(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.episodes(creditId);
  }

  /** Las métricas de recuperación (sobre la mora actual). Mismo alcance que la ficha. */
  @Get(':creditId/metrics')
  @Roles(Permission.COLLECTION_READ)
  metrics(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.metrics(creditId);
  }

  @Get(':creditId/promises')
  @Roles(Permission.COLLECTION_READ)
  promises(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.promises(creditId);
  }

  @Get(':creditId/notes')
  @Roles(Permission.COLLECTION_READ)
  notes(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.notes(creditId);
  }

  /**
   * Registrar una gestión con su resultado y su promesa. `collection:write`: el cobrador la tiene, y sólo la puede
   * registrar sobre un crédito que vea (al día o en mora). No abre ningún caso.
   */
  @Post(':creditId/activities')
  @Roles(Permission.COLLECTION_WRITE)
  addActivity(@Param('creditId', ParseUUIDPipe) creditId: string, @Body() dto: CreateMoraActivityDto) {
    return this.mora.addActivity(creditId, dto);
  }

  /**
   * Fijar la prioridad del episodio de mora abierto a mano (`{ priority: 'HIGH' }`) o soltarla (`{ priority: null }`).
   * Mismo permiso que el endpoint de prioridad del caso: `collection:write` (decir «a éste hay que ir hoy» no es repartir).
   */
  @Patch(':creditId/priority')
  @Roles(Permission.COLLECTION_WRITE)
  setPriority(@Param('creditId', ParseUUIDPipe) creditId: string, @Body() dto: SetMoraPriorityDto) {
    return this.mora.setPriority(creditId, dto);
  }

  /** Escribir una nota: `collection:write` (el cobrador la tiene), y sólo sobre un crédito que pueda ver. */
  @Post(':creditId/notes')
  @Roles(Permission.COLLECTION_WRITE)
  addNote(@Param('creditId', ParseUUIDPipe) creditId: string, @Body() dto: CreateMoraNoteDto) {
    return this.mora.addNote(creditId, dto);
  }

  /**
   * Editar un post-it. `collection:write`, y el service distingue: el texto y el tipo son de quien la escribió o de
   * quien reparte cartera; mover, redimensionar, pintar o traer al frente, de cualquiera que pueda escribir.
   */
  @Patch(':creditId/notes/:noteId')
  @Roles(Permission.COLLECTION_WRITE)
  updateNote(
    @Param('creditId', ParseUUIDPipe) creditId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateMoraNoteDto,
  ) {
    return this.mora.updateNote(creditId, noteId, dto);
  }

  /** Borrar un post-it (borrado lógico). Sólo quien la escribió o quien reparte cartera. */
  @Delete(':creditId/notes/:noteId')
  @Roles(Permission.COLLECTION_WRITE)
  deleteNote(@Param('creditId', ParseUUIDPipe) creditId: string, @Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.mora.deleteNote(creditId, noteId);
  }

  @Get(':creditId')
  @Roles(Permission.COLLECTION_READ)
  findOne(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.findOne(creditId);
  }
}
