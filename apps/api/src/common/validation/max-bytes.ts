import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Largo de un texto en bytes UTF-8 (una tilde o ñ ocupa 2). */
export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Tope de bcrypt: solo usa los primeros 72 bytes, el resto se ignora en silencio. */
export const PASSWORD_MAX_BYTES = 72;
/** Tope amplio del login: solo frena texto basura, no puede ser menor al que hubo al crearla. */
export const LOGIN_PASSWORD_MAX_LENGTH = 128;
/** Máximo estándar de una dirección de correo. */
export const EMAIL_MAX_LENGTH = 254;

/**
 * El texto no puede pasar de `max` **bytes** UTF-8 (no letras).
 *
 * Se usa en toda contraseña que se CREA (registro, invitación, cambio, restablecimiento): bcrypt
 * descarta lo que pasa del byte 72, y dos contraseñas que solo difieren después serían la misma.
 */
export function MaxBytes(max: number, validationOptions?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'maxBytes',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [max],
      options: {
        message: `La contraseña no puede superar ${max} bytes (las tildes y la ñ ocupan 2)`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && byteLength(value) <= max,
      },
    });
  };
}
