import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ROLE_ERROR, ROLE_REASON_MIN_LENGTH } from '@kobrax/shared';

export const roleNotFound = () => new NotFoundException({ code: ROLE_ERROR.NOT_FOUND, message: 'El rol no existe en tu cuenta' });

export const reasonRequired = () =>
  new UnprocessableEntityException({ code: ROLE_ERROR.REASON_REQUIRED, message: `Indica el motivo del cambio (mínimo ${ROLE_REASON_MIN_LENGTH} caracteres)` });

export const versionConflict = (currentVersion: number) =>
  new ConflictException({
    code: ROLE_ERROR.VERSION_CONFLICT,
    message: 'Otra persona cambió este rol mientras lo editabas. Recarga para ver los cambios.',
    details: { currentVersion },
  });

export const noTemplate = () =>
  new UnprocessableEntityException({ code: 'ROLE_NO_TEMPLATE', message: 'Este rol no viene de una plantilla: no hay a qué restaurarlo' });

export const invalidCursor = () => new BadRequestException({ code: 'ROLE_HISTORY_CURSOR_INVALID', message: 'El cursor del historial no es válido' });
