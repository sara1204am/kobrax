import { Controller, Get, Param, Post, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResponseDto } from '@kobrax/shared';
import { RolesAny } from '../auth/decorators/roles.decorator';
import { Permission } from '@kobrax/shared';
import { UploadAccessService } from './upload-access.service';
import { FilesService } from './files.service';
import { fileNotFound } from './uploads.errors';
import { MAX_UPLOAD_BYTES, UploadsService, mimeOf, type UploadedFileLike } from './uploads.service';
import { Authenticated } from '../auth/decorators/authz.decorator';

/**
 * Subida de archivos. F14 · F1: subir exige poder escribir algo que lleve archivos (cliente, gestión, pago, ruta) — antes bastaba una
 * sesión. Leer exige que el archivo cuelgue de algo que la persona ve (`UploadAccessService`). El aislamiento por tenant lo da la
 * carpeta + el guard de tenant global. F14 · F4: la tabla `files` registra el dueño de cada archivo y `FilesService` decide la lectura (`GET /files/:id`); esta ruta por nombre se conserva para el móvil y su caché.
 */
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly access: UploadAccessService,
    private readonly files: FilesService,
  ) {}

  @Post()
  @RolesAny(Permission.CLIENT_WRITE, Permission.COLLECTION_WRITE, Permission.PAYMENT_WRITE, Permission.ROUTE_EXECUTE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: UploadedFileLike) {
    // F14 · F4: queda registrado como PENDING hasta que algo lo ate (los triggers lo pasan a ATTACHED). El registro va ANTES de escribir los bytes
    // (ver `UploadsService.store`). `fileId` es aditivo: el móvil lo ignora.
    let fileId = '';
    const stored = await this.uploads.store(file, async (info) => {
      fileId = await this.files.registerUpload(info);
    });
    return ResponseDto.ok({ ...stored, fileId });
  }

  @Get(':name')
  @Authenticated()
  async download(@Param('name') name: string): Promise<StreamableFile> {
    if (!(await this.access.canRead(name))) throw fileNotFound(); // 404: no se confirma que el archivo existe
    return new StreamableFile(this.uploads.streamOf(name), { type: mimeOf(name) });
  }
}
