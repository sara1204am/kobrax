import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { FilesCleanupService } from './files-cleanup.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { UploadsController } from './uploads.controller';
import { UploadAccessService } from './upload-access.service';
import { UploadsService } from './uploads.service';

/** Almacenamiento de archivos (foto de fachada, comprobante de pago; luego P8-evidencia). */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UploadsController, FilesController],
  providers: [UploadsService, UploadAccessService, FilesService, FilesCleanupService],
  exports: [UploadsService, FilesService],
})
export class UploadsModule {}
