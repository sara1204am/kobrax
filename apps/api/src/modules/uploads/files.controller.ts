import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ResponseDto } from '@kobrax/shared';
import { Authenticated, Public } from '../auth/decorators/authz.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { FilesService } from './files.service';
import { fileNotFound } from './uploads.errors';
import { UploadsService } from './uploads.service';

/**
 * F14 · F4 (ADR-F14-07): lectura de archivos POR IDENTIFICADOR, con la política de lectura de `FilesService` (de qué cuelga el archivo y si
 * la persona ve ese algo). `GET /uploads/:name` sigue existiendo —el móvil y su caché lo usan— con la misma política.
 *
 * Un archivo que no existe y uno que la persona no puede leer dan el MISMO 404: no se confirma que existe.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly uploads: UploadsService,
    private readonly tenant: TenantContextService,
  ) {}

  /** El archivo, con sesión. La política decide; las lecturas de documentos y evidencias quedan auditadas. */
  @Get(':id')
  @Authenticated()
  async read(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.files.findById(id);
    if (!file) throw fileNotFound();
    const access = await this.files.accessFor(file);
    if (!access.allowed) throw fileNotFound();
    await this.files.auditRead(access, 'api');
    res.set({ 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(this.uploads.streamForAccount(this.tenant.accountId, file.storageKey), { type: file.mime });
  }

  /** Un enlace temporal (5 min) para abrir el archivo SIN sesión: una pestaña nueva, un `<img>`, algo que se comparte un momento. */
  @Post(':id/link')
  @Authenticated()
  async link(@Param('id', ParseUUIDPipe) id: string) {
    const file = await this.files.findById(id);
    if (!file) throw fileNotFound();
    const access = await this.files.accessFor(file);
    if (!access.allowed) throw fileNotFound();
    return ResponseDto.ok(await this.files.createLink(access));
  }

  /**
   * El archivo por enlace firmado. SIN sesión: la firma (cuenta + archivo + vencimiento, HMAC con un secreto del servidor) es la
   * credencial. Firma mala, vencida o de otro archivo: 404, igual que un archivo inexistente.
   */
  @Get(':id/raw')
  @Public()
  @RateLimit({ limit: 120, windowSec: 60, by: 'ip' })
  async raw(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('acc') acc: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!acc || !this.files.verifyLink(acc, id, Number(exp), sig)) throw new NotFoundException({ code: 'UPLOAD_002', message: 'Archivo no encontrado' });
    const file = await this.files.findForLink(acc, id);
    if (!file) throw fileNotFound();
    res.set({ 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(this.uploads.streamForAccount(acc, file.storageKey), { type: file.mime });
  }
}
