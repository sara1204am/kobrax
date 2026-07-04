import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Módulo de pagos (RF-09, CU-05): ledger inmutable + aplicación a la deuda + cobro digital. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
