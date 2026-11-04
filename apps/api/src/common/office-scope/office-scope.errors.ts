import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';

/** La oficina pedida no existe en esta cuenta, está desactivada o queda fuera del alcance de quien la pide (A-6). */
export const officeInvalid = (reason: 'NOT_FOUND' | 'INACTIVE' | 'OUT_OF_SCOPE') =>
  new UnprocessableEntityException({
    code: 'CREDIT_BRANCH_INVALID',
    message:
      reason === 'OUT_OF_SCOPE'
        ? 'La oficina indicada está fuera de tu alcance'
        : reason === 'INACTIVE'
          ? 'La oficina indicada está desactivada'
          : 'La oficina indicada no existe en esta cuenta',
    details: { reason },
  });

/** No hay forma de decidir la oficina: nunca se guarda un crédito sin oficina (A-1, A-6). */
export const officeUnresolved = () =>
  new UnprocessableEntityException({
    code: 'CREDIT_BRANCH_UNRESOLVED',
    message: 'No se pudo determinar la oficina del crédito. Indica la oficina o asigna un responsable que trabaje en una.',
  });

/** Algún crédito del lote está en una oficina que quien reasigna no alcanza. */
export const officeOutOfScope = (creditIds: string[]) =>
  new ForbiddenException({
    code: 'CREDIT_OFFICE_OUT_OF_SCOPE',
    message: 'Algún crédito está en una oficina fuera de tu alcance',
    details: { creditIds },
  });
