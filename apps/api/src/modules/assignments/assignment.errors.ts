import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

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
    message: 'El responsable elegido no es un cobrador o supervisor activo de la empresa',
    details: { userIds },
  });

/**
 * Un supervisor reparte sólo dentro de su agencia (D8): el crédito o el destinatario son de otra, o él no
 * tiene agencia asignada.
 */
export const assignmentOutOfAgency = (creditIds: string[], userIds: string[]) =>
  new ForbiddenException({
    code: 'ASSIGNMENT_OUT_OF_AGENCY',
    message: 'Sólo podés repartir créditos de tu agencia a personas de tu agencia',
    details: { creditIds, userIds },
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

/** El crédito no existe, está borrado o es de otra cuenta (genérico, anti-enumeración). */
export const assignmentCreditNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

/** La asignación no existe, ya se revocó o es de otra cuenta. */
export const assignmentNotFound = () =>
  new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND', message: 'La asignación no existe o ya no está vigente' });

/** El responsable (PRINCIPAL) no se revoca: se cambia por otro. */
export const assignmentNotRevocable = () =>
  new UnprocessableEntityException({
    code: 'ASSIGNMENT_NOT_REVOCABLE',
    message: 'El responsable principal no se revoca: se reasigna a otra persona',
  });

/** El reemplazo temporal exige un vencimiento futuro. */
export const temporaryExpiryInvalid = () =>
  new UnprocessableEntityException({
    code: 'TEMPORARY_EXPIRY_INVALID',
    message: 'El vencimiento tiene que ser una fecha futura',
  });

/** Reemplazar temporalmente exige que alguien sea hoy el responsable. */
export const assignmentNoPrincipal = () =>
  new UnprocessableEntityException({
    code: 'ASSIGNMENT_NO_PRINCIPAL',
    message: 'El crédito no tiene responsable a quien reemplazar',
  });

/** El destinatario ya es el responsable del crédito: no necesita reemplazo ni ayuda. */
export const assignmentSameAsPrincipal = () =>
  new UnprocessableEntityException({
    code: 'ASSIGNMENT_SAME_AS_PRINCIPAL',
    message: 'Esa persona ya es la responsable del crédito',
  });

/** Ya hay un reemplazo temporal vigente en el crédito, o esa persona ya es su ayuda. */
export const assignmentDuplicate = (what: 'TEMPORAL' | 'APOYO') =>
  new ConflictException({
    code: what === 'TEMPORAL' ? 'ASSIGNMENT_TEMPORARY_EXISTS' : 'ASSIGNMENT_SUPPORT_EXISTS',
    message:
      what === 'TEMPORAL'
        ? 'El crédito ya tiene un reemplazo temporal vigente: revocalo antes de poner otro'
        : 'Esa persona ya es la ayuda de este crédito',
  });
