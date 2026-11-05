import { Controller, Get, Param, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResponseDto } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RolesAny } from '../auth/decorators/roles.decorator';
import { Permission } from '@kobrax/shared';
import { UploadAccessService } from './upload-access.service';
import { fileNotFound } from './uploads.errors';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { MAX_UPLOAD_BYTES, UploadsService, mimeOf, type UploadedFileLike } from './uploads.service';

/**
 * Subida de archivos. F14 · F1: subir exige poder escribir algo que lleve archivos (cliente, gestión, pago, ruta) — antes bastaba una
 * sesión. Leer exige que el archivo cuelgue de algo que la persona ve (`UploadAccessService`). El aislamiento por tenant lo da la
 * carpeta + `TenantGuard`. Interino hasta la tabla `files` de F4.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly access: UploadAccessService,
  ) {}

  @Post()
  @RolesAny(Permission.CLIENT_WRITE, Permission.COLLECTION_WRITE, Permission.PAYMENT_WRITE, Permission.ROUTE_EXECUTE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: UploadedFileLike) {
    return ResponseDto.ok(await this.uploads.store(file));
  }

  @Get(':name')
  async download(@Param('name') name: string): Promise<StreamableFile> {
    if (!(await this.access.canRead(name))) throw fileNotFound(); // 404: no se confirma que el archivo existe
    return new StreamableFile(this.uploads.streamOf(name), { type: mimeOf(name) });
  }
}
