import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';

/** Cambiar quién es responsable de un crédito exige `assignment:write`. */
export const assignmentForbidden = () =>
  new ForbiddenException({
    code: 'ASSIGNMENT_FORBIDDEN',
    message: 'No tenés permiso para cambiar el responsable de un crédito',
  });

/** Uno o más destinatarios no son asignables: no pertenecen a la cuenta, están inactivos o no cobran. */
export const assigneeNotEligible = (userIds: string[]) =>
  new UnprocessableEntityException({
    code: 'ASSIGNEE_NOT_ELIGIBLE',
    message: 'El responsable elegido no es un cobrador activo de la empresa',
    details: { userIds },
  });

/**
 * El responsable cambió entre que se miró y que se guardó: otra persona reasignó en el medio, o
 * dos escrituras chocaron contra el índice de «una permanente por crédito».
 */
export const assignmentConflict = (creditIds: string[] = []) =>
  new ConflictException({
    code: 'ASSIGNMENT_CONFLICT',
    message: 'El responsable de uno o más créditos cambió mientras tanto. Volvé a cargar y revisá.',
    details: { creditIds },
  });
