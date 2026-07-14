import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/** Almacenamiento de archivos (foto de fachada, comprobante de pago; luego P8-evidencia). */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
