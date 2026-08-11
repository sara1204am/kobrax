import { Controller, Get, Param, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResponseDto } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { MAX_UPLOAD_BYTES, UploadsService, mimeOf, type UploadedFileLike } from './uploads.service';

/**
 * Subida de archivos. Sin `@Roles`: cualquiera con sesión puede subir, porque el objeto no es nada
 * hasta que se ata a un recurso (el adjunto del cliente, el comprobante del pago) — y ESE endpoint
 * sí exige permiso. El aislamiento por tenant lo da la carpeta + `TenantGuard`.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: UploadedFileLike) {
    return ResponseDto.ok(await this.uploads.store(file));
  }

  @Get(':name')
  download(@Param('name') name: string): StreamableFile {
    return new StreamableFile(this.uploads.streamOf(name), { type: mimeOf(name) });
  }
}
