/**
 * Validación del formulario de login en el navegador, antes de llamar al servidor.
 *
 * Las reglas son las mismas que `LoginDto` en la API (el servidor no confía solo en el navegador).
 * Devuelve **claves** de mensaje (namespace `login.validation`), no textos, para que es/en salgan
 * del diccionario.
 */
export const EMAIL_MAX_LENGTH = 254;
/** Tope amplio: solo frena texto basura. Más bajo dejaría afuera contraseñas largas ya creadas. */
export const LOGIN_PASSWORD_MAX_LENGTH = 128;

export type LoginFieldError =
  | 'emailRequired'
  | 'emailInvalid'
  | 'emailTooLong'
  | 'passwordRequired'
  | 'passwordTooLong';

export interface LoginFieldErrors {
  email?: LoginFieldError;
  password?: LoginFieldError;
}

// Algo@algo.algo, sin espacios: lo mismo que pide la API en la práctica, sin pretender ser el RFC.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const mail = email.trim();
  if (!mail) errors.email = 'emailRequired';
  else if (mail.length > EMAIL_MAX_LENGTH) errors.email = 'emailTooLong';
  else if (!EMAIL_SHAPE.test(mail)) errors.email = 'emailInvalid';

  if (!password) errors.password = 'passwordRequired';
  else if (password.length > LOGIN_PASSWORD_MAX_LENGTH) errors.password = 'passwordTooLong';
  return errors;
}
