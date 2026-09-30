import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
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
import type { ImportConfigPatch } from './import-config';

// Sin @types/multer: solo necesitamos el buffer (FileInterceptor usa memoria por defecto).
interface UploadedPortfolioFile {
  buffer: Buffer;
  originalname?: string;
}

// Formas de archivo soportadas (FIELD-RULES §4.1). El match contra la forma CONFIGURADA lo hace
// el service: `fileFilter` es síncrono y no ve el tenant, meterle una lectura de DB no se paga.
const ACCEPTED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
]);

@Controller('imports/portfolio')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PortfolioImportController {
  constructor(private readonly portfolio: PortfolioImportService) {}

  /**
   * N3: la configuración de importación del tenant + lo que la pantalla de Ajustes necesita
   * para dibujarse (catálogo de campos, presets, última corrida). Una sola llamada.
   *
   * Vive acá y no en un módulo `accounts` —que no existe— para no montar un módulo entero por
   * un endpoint: este controller ya tiene los guards y el permiso puestos.
   */
  @Get('config')
  @Roles(Permission.CLIENT_IMPORT)
  getConfig() {
    return this.portfolio.getConfigScreen();
  }

  @Patch('config')
  @Roles(Permission.CLIENT_IMPORT)
  patchConfig(@Body() body: ImportConfigPatch) {
    return this.portfolio.patchConfig(body);
  }

  /**
   * N1: sube el archivo (multipart) → lectura + reconcile. `dryRun=true` = solo Vista Previa.
   * `columnsOnly=true` = sólo devuelve qué etiquetas/columnas trae el archivo, para emparejar
   * en Ajustes sin correr el reconcile (§6.5).
   */
  @Post()
  @Roles(Permission.CLIENT_IMPORT)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 }, // N6: 15 MB
      // Cortar temprano: no gastar el motor sobre bytes de cualquier tipo.
      fileFilter: (_req: unknown, file: { mimetype?: string }, cb: (e: Error | null, ok: boolean) => void) =>
        cb(null, ACCEPTED_MIME.has(file?.mimetype ?? '')),
    }),
  )
  run(
    @UploadedFile() file: UploadedPortfolioFile | undefined,
    @Body('dryRun') dryRun?: string,
    @Query('columnsOnly') columnsOnly?: string,
    // D9: la fecha de corte, si el reporte no la trae (o para corregirla). YYYY-MM-DD.
    @Body('reportDate') reportDate?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Falta el archivo (campo file)' });
    }
    if (columnsOnly === 'true') return this.portfolio.readColumns(file.buffer);
    return this.portfolio.run(file.buffer, dryRun === 'true', { reportDate: reportDate || undefined });
  }

  /**
   * D8: de qué usuario es cada código de asesor de los reportes. El código no es la identidad del
   * usuario: sólo dice de quién es un reporte, y con eso qué operaciones pueden quedar ausentes.
   */
  @Get('advisors')
  @Roles(Permission.CLIENT_IMPORT)
  listAdvisors() {
    return this.portfolio.listAdvisorLinks();
  }

  @Put('advisors/:code')
  @Roles(Permission.CLIENT_IMPORT)
  linkAdvisor(@Param('code') code: string, @Body('userId') userId?: string) {
    if (!userId) throw new BadRequestException({ code: 'USER_REQUIRED', message: 'Falta el usuario (userId)' });
    return this.portfolio.linkAdvisor(code, userId);
  }

  @Delete('advisors/:code')
  @Roles(Permission.CLIENT_IMPORT)
  unlinkAdvisor(@Param('code') code: string) {
    return this.portfolio.unlinkAdvisor(code);
  }
}
