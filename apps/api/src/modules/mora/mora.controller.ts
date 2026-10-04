import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateMoraActivityDto, CreateMoraNoteDto, ListMoraQueryDto } from './dto/mora.dto';
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
  @Roles(Permission.CASE_READ)
  list(@Query() query: ListMoraQueryDto) {
    return this.mora.list(query);
  }

  /**
   * Exportar lo que se está viendo: mismo filtro, orden y alcance que `GET /mora`.
   *
   * Exige `case:export` **y** `case:read`: se descarga lo que se podría mirar. No es `report:export`, que
   * abre los exports de toda la cuenta sin acotar por alcance. Van antes de `:creditId`.
   */
  @Get('export.csv')
  @Roles(Permission.CASE_READ, Permission.CASE_EXPORT)
  async exportCsv(@Query() query: ListMoraQueryDto): Promise<StreamableFile> {
    const file = await this.exporter.csv(query);
    return new StreamableFile(file.stream, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${file.filename}"` });
  }

  @Get('export.pdf')
  @Roles(Permission.CASE_READ, Permission.CASE_EXPORT)
  async exportPdf(@Query() query: ListMoraQueryDto): Promise<StreamableFile> {
    const file = await this.exporter.pdf(query);
    return new StreamableFile(file.content, { type: 'application/pdf', disposition: `attachment; filename="${file.filename}"` });
  }

  /** Las oficinas para el filtro. Va antes de `:creditId`. */
  @Get('branches')
  @Roles(Permission.CASE_READ)
  branches() {
    return this.mora.branches();
  }

  /** Va antes de `:creditId`: «by-case» no es un id. */
  @Get('by-case/:caseId')
  @Roles(Permission.CASE_READ)
  byCase(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.mora.byCase(caseId);
  }

  /** El historial de mora del crédito. Va antes de `:creditId` por el mismo motivo que `by-case`. */
  @Get(':creditId/episodes')
  @Roles(Permission.CASE_READ)
  episodes(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.episodes(creditId);
  }

  /** Las métricas de recuperación (sobre la mora actual). Mismo alcance que la ficha. */
  @Get(':creditId/metrics')
  @Roles(Permission.CASE_READ)
  metrics(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.metrics(creditId);
  }

  @Get(':creditId/promises')
  @Roles(Permission.CASE_READ)
  promises(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.promises(creditId);
  }

  @Get(':creditId/notes')
  @Roles(Permission.CASE_READ)
  notes(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.notes(creditId);
  }

  /**
   * Registrar una gestión con su resultado y su promesa. `case:write`: el cobrador la tiene, y sólo la puede
   * registrar sobre un crédito que vea. Si el crédito no tiene caso, lo abre.
   */
  @Post(':creditId/activities')
  @Roles(Permission.CASE_WRITE)
  addActivity(@Param('creditId', ParseUUIDPipe) creditId: string, @Body() dto: CreateMoraActivityDto) {
    return this.mora.addActivity(creditId, dto);
  }

  /** Escribir una nota: `case:write` (el cobrador la tiene), y sólo sobre un crédito que pueda ver. */
  @Post(':creditId/notes')
  @Roles(Permission.CASE_WRITE)
  addNote(@Param('creditId', ParseUUIDPipe) creditId: string, @Body() dto: CreateMoraNoteDto) {
    return this.mora.addNote(creditId, dto);
  }

  @Get(':creditId')
  @Roles(Permission.CASE_READ)
  findOne(@Param('creditId', ParseUUIDPipe) creditId: string) {
    return this.mora.findOne(creditId);
  }
}
