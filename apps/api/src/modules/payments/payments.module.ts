import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentIntegrityService } from './payment-integrity.service';

/** Módulo de pagos (RF-09, CU-05): ledger inmutable + aplicación a la deuda + cobro digital. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentIntegrityService],
})
export class PaymentsModule {}
