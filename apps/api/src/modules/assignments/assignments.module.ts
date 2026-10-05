import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentService } from './assignment.service';

/** El responsable de un crédito se escribe sólo desde acá. Lo usan créditos e import. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AssignmentsController],
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssignmentsModule {}
