import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { MoveCheck } from '@kobrax/shared';

export const branchNotFound = () =>
  new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Oficina no encontrada' });

export const branchCodeDuplicate = (code: string) =>
  new ConflictException({ code: 'BRANCH_CODE_DUPLICATE', message: 'Ya existe una oficina con ese código', details: { code } });

/** Dar de baja una oficina con gente adentro dejaría a esas personas sin alcance: primero se las pasa a otra. */
export const branchHasMembers = (members: number) =>
  new ConflictException({
    code: 'BRANCH_HAS_MEMBERS',
    message: 'La oficina tiene personas asignadas. Pásalas a otra oficina antes de desactivarla o quitarla.',
    details: { members },
  });

/** Una oficina con hijas activas deja a esas hijas colgando de un nodo apagado. */
export const branchHasChildren = (children: number) =>
  new ConflictException({
    code: 'BRANCH_HAS_CHILDREN',
    message: 'La oficina tiene oficinas hijas activas. Desactívalas o muévelas antes.',
    details: { children },
  });

/** Los créditos quedarían en una oficina apagada: primero se reasignan (POST /credits/reassign-office). */
export const branchHasCredits = (credits: number) =>
  new ConflictException({
    code: 'BRANCH_HAS_CREDITS',
    message: 'La oficina tiene créditos. Reasígnalos a otra oficina antes de desactivarla o quitarla.',
    details: { credits },
  });

/** La raíz es la razón social de la cuenta: no se desactiva, no se borra y no se mueve. */
export const branchRootProtected = () =>
  new UnprocessableEntityException({
    code: 'BRANCH_ROOT_PROTECTED',
    message: 'La oficina raíz representa a la empresa: no se desactiva, no se elimina ni se mueve.',
  });

/** El responsable tiene que ser un miembro activo de esta misma cuenta. */
export const branchManagerInvalid = () =>
  new BadRequestException({ code: 'BRANCH_MANAGER_INVALID', message: 'El responsable debe ser un miembro activo de la cuenta' });

/** Alguno de los miembros a mover no pertenece a la cuenta o está inactivo. */
export const branchMembersInvalid = () =>
  new BadRequestException({ code: 'BRANCH_MEMBERS_INVALID', message: 'Alguno de los miembros no existe o está inactivo' });

export const branchInactive = () =>
  new BadRequestException({ code: 'BRANCH_INACTIVE', message: 'No se puede asignar a una oficina desactivada' });

/** El padre no existe en esta cuenta (una oficina de otra cuenta se ve exactamente igual: no existe). */
export const branchParentInvalid = () =>
  new UnprocessableEntityException({ code: 'BRANCH_PARENT_INVALID', message: 'La oficina superior no existe en esta cuenta' });

export const branchParentInactive = () =>
  new UnprocessableEntityException({ code: 'BRANCH_PARENT_INACTIVE', message: 'La oficina superior está desactivada' });

export const branchTooDeep = (max: number) =>
  new UnprocessableEntityException({ code: 'BRANCH_TOO_DEEP', message: `El árbol de oficinas admite hasta ${max} niveles por debajo de la raíz`, details: { max } });

export const branchTypeInvalid = () =>
  new UnprocessableEntityException({ code: 'BRANCH_TYPE_INVALID', message: 'El tipo de oficina no existe o está desactivado' });

export const branchTypeNotFound = () =>
  new NotFoundException({ code: 'BRANCH_TYPE_NOT_FOUND', message: 'Tipo de oficina no encontrado' });

export const branchTypeCodeDuplicate = (code: string) =>
  new ConflictException({ code: 'BRANCH_TYPE_CODE_DUPLICATE', message: 'Ya existe un tipo de oficina con ese código', details: { code } });

/** Hay una sola asignación vigente por persona (límite temporal del modelo): una segunda se rechaza con el dato de la actual. */
export const branchAssignmentExists = (userId: string, branchId: string | null) =>
  new ConflictException({
    code: 'BRANCH_ASSIGNMENT_EXISTS',
    message: 'La persona ya tiene una oficina asignada. Por ahora una persona trabaja en una sola oficina: muévela en lugar de sumarle otra.',
    details: { userId, branchId },
  });

export const branchMemberNotFound = () =>
  new NotFoundException({ code: 'BRANCH_MEMBER_NOT_FOUND', message: 'La persona no está asignada a esta oficina' });

/** Por qué `checkOfficeMove` no dejó mover. */
export const branchMoveInvalid = (reason: Exclude<MoveCheck, 'OK' | 'SAME_PARENT'>, max: number) => {
  if (reason === 'IS_ROOT') return branchRootProtected();
  if (reason === 'TOO_DEEP') return branchTooDeep(max);
  return new UnprocessableEntityException({
    code: 'BRANCH_MOVE_CYCLE',
    message: 'Una oficina no puede colgar de sí misma ni de una de sus descendientes',
    details: { reason },
  });
};
