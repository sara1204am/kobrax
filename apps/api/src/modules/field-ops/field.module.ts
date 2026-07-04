import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { FieldController } from './field.controller';
import { FieldService } from './field.service';

/** Módulo de operación en campo (RF-08, CU-04 backend): visitas + evidencia sellada. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [FieldController],
  providers: [FieldService],
})
export class FieldModule {}
