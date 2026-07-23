import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PortfolioImportService } from './portfolio-import.service';

// Sin @types/multer: solo necesitamos el buffer (FileInterceptor usa memoria por defecto).
interface UploadedPortfolioFile {
  buffer: Buffer;
  originalname?: string;
}

@Controller('imports/portfolio')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PortfolioImportController {
  constructor(private readonly portfolio: PortfolioImportService) {}

  /** N1: sube el extracto (multipart) → parseo + reconcile. `dryRun=true` = solo Vista Previa. */
  @Post()
  @Roles(Permission.CLIENT_IMPORT)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 }, // N6: 15 MB
      // Cortar temprano: exigir PDF antes de gastar pdfjs sobre bytes arbitrarios.
      fileFilter: (_req: unknown, file: { mimetype?: string }, cb: (e: Error | null, ok: boolean) => void) =>
        cb(null, file?.mimetype === 'application/pdf'),
    }),
  )
  run(@UploadedFile() file: UploadedPortfolioFile | undefined, @Body('dryRun') dryRun?: string) {
    if (!file?.buffer) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Falta el archivo (campo file)' });
    }
    return this.portfolio.run(file.buffer, dryRun === 'true');
  }
}
