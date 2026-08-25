import { Controller, Get, StreamableFile, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExportsService, type ExportFile } from './exports.service';

function toFile(f: ExportFile): StreamableFile {
  return new StreamableFile(f.content, {
    type: f.contentType,
    disposition: `attachment; filename="${f.filename}"`,
  });
}

/** Descargas de datos de la cuenta. Todo detrás de `REPORT_EXPORT`, el permiso ya reservado para esto. */
@Controller('exports')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Permission.REPORT_EXPORT)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('clients')
  async clients(): Promise<StreamableFile> {
    return toFile(await this.exports.clientsCsv());
  }

  @Get('locations')
  async locations(): Promise<StreamableFile> {
    return toFile(await this.exports.locationsCsv());
  }

  @Get('cases')
  async cases(): Promise<StreamableFile> {
    return toFile(await this.exports.casesCsv());
  }

  @Get('agenda')
  async agenda(): Promise<StreamableFile> {
    return toFile(await this.exports.agendaCsv());
  }

  @Get('backup')
  async backup(): Promise<StreamableFile> {
    return toFile(await this.exports.fullBackup());
  }
}
