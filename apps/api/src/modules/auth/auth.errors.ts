import {
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

/** 423 Locked (no está en el enum HttpStatus de esta versión de Nest). */
const HTTP_LOCKED = 423;

/** Códigos de error del dominio auth (contrato de la API). */
export const AUTH_ERR = {
  INVALID_CREDENTIALS: 'AUTH_001',
  ACCOUNT_LOCKED: 'AUTH_002',
  INVALID_TOKEN: 'AUTH_003',
  REUSE_DETECTED: 'AUTH_004',
  REFRESH_RETRY: 'AUTH_004_RETRY',
  RESET_TOKEN_INVALID: 'AUTH_005',
  MFA_INVALID: 'AUTH_006',
  ACCOUNT_NOT_ALLOWED: 'AUTH_007',
  WEAK_PASSWORD: 'AUTH_008',
  MFA_REQUIRED: 'AUTH_009',
} as const;

export const invalidCredentials = () =>
  new UnauthorizedException({ code: AUTH_ERR.INVALID_CREDENTIALS, message: 'Credenciales inválidas' });

export const invalidToken = () =>
  new UnauthorizedException({ code: AUTH_ERR.INVALID_TOKEN, message: 'Token inválido o expirado' });

export const reuseDetected = () =>
  new UnauthorizedException({
    code: AUTH_ERR.REUSE_DETECTED,
    message: 'Refresh token reutilizado: sesión revocada por seguridad',
  });

export const refreshRetry = () =>
  new UnauthorizedException({
    code: AUTH_ERR.REFRESH_RETRY,
    message: 'Refresh en curso, reintentar con el token más reciente',
  });

export const accountLocked = (lockedUntil: Date) =>
  new HttpException(
    {
      code: AUTH_ERR.ACCOUNT_LOCKED,
      message: 'Cuenta bloqueada temporalmente por intentos fallidos',
      details: { lockedUntil: lockedUntil.toISOString() },
    },
    HTTP_LOCKED,
  );

export const noActiveTenant = () =>
  new HttpException(
    { code: AUTH_ERR.ACCOUNT_NOT_ALLOWED, message: 'El usuario no tiene una empresa activa' },
    HttpStatus.FORBIDDEN,
  );

/** Pre-auth token inválido/expirado o usado en el paso equivocado. */
export const invalidPreAuth = () =>
  new UnauthorizedException({
    code: AUTH_ERR.INVALID_TOKEN,
    message: 'Token de pre-autenticación inválido o expirado',
  });

/** Código MFA (TOTP o backup) inválido. */
export const mfaInvalid = () =>
  new UnauthorizedException({ code: AUTH_ERR.MFA_INVALID, message: 'Código MFA inválido' });

/** Intento de verificar MFA sin haber hecho enroll primero. */
export const mfaNotEnrolled = () =>
  new BadRequestException({
    code: AUTH_ERR.MFA_INVALID,
    message: 'MFA no iniciado: realiza el enroll antes de verificar',
  });

/** El usuario no pertenece a la empresa seleccionada o el tenant no está activo. */
export const accountNotAllowed = () =>
  new HttpException(
    {
      code: AUTH_ERR.ACCOUNT_NOT_ALLOWED,
      message: 'No pertenece a la empresa seleccionada o el tenant no está activo',
    },
    HttpStatus.FORBIDDEN,
  );

/** Token de reset inválido, expirado o ya usado (F2b). */
export const resetTokenInvalid = () =>
  new BadRequestException({
    code: AUTH_ERR.RESET_TOKEN_INVALID,
    message: 'Token de recuperación inválido o expirado',
  });

/** La nueva contraseña no cumple la política (F2b). */
export const weakPassword = () =>
  new BadRequestException({
    code: AUTH_ERR.WEAK_PASSWORD,
    message: 'La contraseña no cumple la política (mín. 8, mayúscula, número y símbolo)',
  });

/** MFA obligatorio para el rol y aún no enrolado (F2b enforcement). */
export const mfaRequired = () =>
  new HttpException(
    { code: AUTH_ERR.MFA_REQUIRED, message: 'MFA obligatorio: completa el enroll para continuar' },
    HttpStatus.FORBIDDEN,
  );
