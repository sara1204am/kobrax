import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export const branchNotFound = () =>
  new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Agencia no encontrada' });

export const branchCodeDuplicate = (code: string) =>
  new ConflictException({ code: 'BRANCH_CODE_DUPLICATE', message: 'Ya existe una agencia con ese código', details: { code } });

/** Dar de baja una agencia con gente adentro dejaría a esas personas sin alcance: primero se las pasa a otra. */
export const branchHasMembers = (members: number) =>
  new ConflictException({
    code: 'BRANCH_HAS_MEMBERS',
    message: 'La agencia tiene miembros activos. Pásalos a otra agencia antes de desactivarla o quitarla.',
    details: { members },
  });

/** El responsable tiene que ser un miembro activo de esta misma cuenta. */
export const branchManagerInvalid = () =>
  new BadRequestException({ code: 'BRANCH_MANAGER_INVALID', message: 'El responsable debe ser un miembro activo de la cuenta' });

/** Alguno de los miembros a mover no pertenece a la cuenta o está inactivo. */
export const branchMembersInvalid = () =>
  new BadRequestException({ code: 'BRANCH_MEMBERS_INVALID', message: 'Alguno de los miembros no existe o está inactivo' });

export const branchInactive = () =>
  new BadRequestException({ code: 'BRANCH_INACTIVE', message: 'No se puede asignar a una agencia desactivada' });
