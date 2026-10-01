import { Controller, Get, UseGuards } from '@nestjs/common';
import { Permission } from '@kobrax/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AssignmentService } from './assignment.service';

@Controller('assignments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentService) {}

  /**
   * A quién se le puede asignar un crédito. Con `assignment:write` y no con `user:read`: el
   * supervisor reparte cartera pero no administra el equipo, y el selector no puede depender de
   * la lista de usuarios para eso.
   */
  @Get('assignees')
  @Roles(Permission.ASSIGNMENT_WRITE)
  assignees() {
    return this.assignments.listAssignees();
  }
}
