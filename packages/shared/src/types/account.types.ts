import type { PlanLimits } from '../constants/plans.js';
import type { ArrearsMethod } from '../enums/credit.enum.js';

/**
 * Cuenta y perfil propio: lo que devuelve la API y lo que acepta editar.
 *
 * Vive acá y no en cada app porque el móvil y la web editan **los mismos campos** contra los
 * mismos endpoints (`/accounts/me`, `/users/me/profile`). Dos declaraciones del mismo contrato
 * se separan en silencio y el desajuste aparece como un 400 en producción.
 */

/** `GET /accounts/me`. Trae más de lo que se puede editar: `limits` y `usage` son de lectura. */
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
  /**
   * Cuántos decimales muestran los montos (0–2, default 2). Preferencia de la cuenta: una
   * cartera que presta en enteros no quiere leer «,00» en cada renglón. Vive en `settings`.
   */
  currencyDecimals: number;
  /**
   * Cómo se cuentan los días de mora por defecto en los créditos nuevos (D20). Viene preseleccionado en
   * el alta; cada crédito guarda el suyo. Vive en `settings`. `oldest_unpaid` si la cuenta no lo eligió.
   */
  arrearsMethod: ArrearsMethod;
  /**
   * Los topes que rigen para esta cuenta: los del plan con su excepción ya aplicada.
   *
   * Viene resuelto del servidor y no como `planCode` + excepción a mano, porque si cada pantalla
   * lo calculara, la web, el móvil y la API tendrían tres oportunidades de calcularlo distinto.
   */
  limits: PlanLimits;
  /**
   * Cuánto lleva usado de cada tope **que hoy se cuenta**. Fotos y gestiones son lo que va
   * **del mes** (se reinician el 1, en el huso de la cuenta); los otros tres son el total vivo.
   * Un tope que algún día se cuente se suma acá, y recién entonces la pantalla le dibuja barra.
   */
  usage: {
    users: number;
    credits: number;
    clients: number;
    photosPerMonth: number;
    actionsPerMonth: number;
  };
}

/**
 * Los 5 campos que `PATCH /accounts/me` acepta.
 *
 * ⚠️ Se manda **sólo lo que cambió**: la API corre con `forbidNonWhitelisted: true`, así que
 * reenviar el objeto del `GET` (con `planCode`, `limits`, `usage`…) es un **400**, no
 * un no-op. El recorte lo hace `diffAccount`.
 */
export interface AccountPatch {
  businessName?: string;
  /** `null` = quitarlo. Es opcional, así que se puede borrar. */
  taxId?: string | null;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string | null;
  /** Viaja como string ('0'|'1'|'2') porque sale de un `<select>` y el diff es de strings. */
  currencyDecimals?: string;
  /** Método de mora por defecto de los créditos nuevos (D20). */
  arrearsMethod?: string;
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
  /**
   * `''` = «según el país»: viaja como `null` y el servidor cae al huso del país
   * (`TZ_BY_COUNTRY`). La edita la web (S1-D2); el móvil la muestra y no la toca.
   */
  timezone: string;
  /** '0'|'1'|'2' — string porque es un `<select>`. La edita la web; el móvil sólo la lee. */
  currencyDecimals: string;
  /** Método de mora por defecto (D20). La edita la web; el móvil sólo la lee. */
  arrearsMethod: string;
}

export interface ProfileForm {
  firstName: string;
  lastName: string;
  phone: string;
  photoUrl: string;
  /** `''` = no tiene. Quitarlo se traduce a `null` en `diffProfile`. */
  paymentQrUrl: string;
}
