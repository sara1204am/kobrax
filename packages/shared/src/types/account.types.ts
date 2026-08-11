/**
 * Cuenta y perfil propio: lo que devuelve la API y lo que acepta editar.
 *
 * Vive acá y no en cada app porque el móvil y la web editan **los mismos campos** contra los
 * mismos endpoints (`/accounts/me`, `/users/me/profile`). Dos declaraciones del mismo contrato
 * se separan en silencio y el desajuste aparece como un 400 en producción.
 */

/** `GET /accounts/me`. Trae más de lo que se puede editar: `memberCount` y `maxUsers` son de lectura. */
export interface AccountInfo {
  id: string;
  businessName: string;
  taxId: string | null;
  accountType: string;
  status: string;
  planCode: string;
  countryCode: string;
  currencyCode: string;
  timezone: string | null;
  maxUsers: number;
  memberCount: number;
}

/**
 * Los 5 campos que `PATCH /accounts/me` acepta.
 *
 * ⚠️ Se manda **sólo lo que cambió**: la API corre con `forbidNonWhitelisted: true`, así que
 * reenviar el objeto del `GET` (con `planCode`, `maxUsers`, `memberCount`…) es un **400**, no
 * un no-op. El recorte lo hace `diffAccount`.
 */
export interface AccountPatch {
  businessName?: string;
  /** `null` = quitarlo. Es opcional, así que se puede borrar. */
  taxId?: string | null;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string | null;
}

/** `GET /users/me/profile`. */
export interface MyProfile {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  photoUrl: string | null;
  /** QR bancario propio, el que se le muestra al deudor para que pague desde su app del banco. */
  paymentQrUrl: string | null;
}

/** En los opcionales, `null` = quitarlo y ausente = no tocarlo. Son cosas distintas para el servidor. */
export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  photoUrl?: string | null;
  paymentQrUrl?: string | null;
}

/** El formulario en pantalla: todo string, porque un input vacío es `''` y no `null`. */
export interface AccountForm {
  businessName: string;
  taxId: string;
  countryCode: string;
  currencyCode: string;
}

export interface ProfileForm {
  firstName: string;
  lastName: string;
  phone: string;
  photoUrl: string;
  /** `''` = no tiene. Quitarlo se traduce a `null` en `diffProfile`. */
  paymentQrUrl: string;
}
