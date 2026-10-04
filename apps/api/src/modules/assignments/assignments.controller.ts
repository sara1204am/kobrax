import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AssignmentService } from './assignment.service';
import { BulkReassignDto, CreateSupportAssignmentDto, CreateTemporaryAssignmentDto } from './dto/assignment.dto';

@Controller('assignments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentService) {}

  /**
   * A quién se le puede asignar un crédito. Con `assignment:write` y no con `user:read`: el
   * supervisor reparte cartera pero no administra el equipo, y el selector no puede depender de
   * la lista de usuarios para eso. El supervisor sólo ve a su agencia.
   */
  @Get('assignees')
  @Roles(Permission.ASSIGNMENT_WRITE)
  assignees() {
    return this.assignments.listAssignees();
  }

  /**
   * Reasigna el responsable de varios créditos (acción masiva de la mora). Cada crédito es atómico y los que no se
   * pueden (ya es suyo, fuera de la agencia del supervisor, borrado, cambió) vuelven en `skipped`.
   */
  @Post('bulk')
  @Roles(Permission.ASSIGNMENT_WRITE)
  bulk(@Body() dto: BulkReassignDto) {
    return this.assignments.bulkReassign({ creditIds: dto.creditIds, userId: dto.userId });
  }

  /**
   * Reemplazo temporal de un crédito (D8-a). Lo agendado pendiente del responsable pasa al reemplazo y vuelve
   * al vencer o al revocar. El responsable conserva el crédito. Fuera de la agencia del supervisor: 403.
   */
  @Post('temporary')
  @Roles(Permission.ASSIGNMENT_WRITE)
  createTemporary(@Body() dto: CreateTemporaryAssignmentDto) {
    return this.assignments.createTemporary({
      creditId: dto.creditId,
      userId: dto.userId,
      expiresAt: new Date(dto.expiresAt),
      reason: dto.reason,
    });
  }

  /** Ayuda: un segundo cobrador que ve y trabaja el crédito. Sin traspaso de agenda. */
  @Post('support')
  @Roles(Permission.ASSIGNMENT_WRITE)
  createSupport(@Body() dto: CreateSupportAssignmentDto) {
    return this.assignments.createSupport({
      creditId: dto.creditId,
      userId: dto.userId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
  }

  /** Revoca un reemplazo temporal o una ayuda (el responsable no se revoca: se reasigna). */
  @Delete(':id')
  @Roles(Permission.ASSIGNMENT_WRITE)
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.revoke(id);
  }
}
