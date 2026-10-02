/**
 * Registrar una gestión de cobranza con su **resultado** y, si corresponde, su **promesa de pago**.
 *
 * Es la regla del negocio, escrita una vez: el panel la usa para no ofrecer lo que la API va a rechazar, la API
 * la usa para rechazarlo de verdad, y el móvil usará la misma. Antes `result` era un texto libre sin validar y la
 * promesa no se podía registrar desde el panel.
 */

/** Lo que se puede registrar a mano. Los demás tipos (pago, cambio de estado, asignación) los escribe el sistema. */
export const RECOVERY_ACTIVITY_TYPES = ['CALL', 'VISIT', 'MESSAGE', 'NOTE'] as const;
export type RecoveryActivityType = (typeof RECOVERY_ACTIVITY_TYPES)[number];

/**
 * Los desenlaces de una gestión. Son valores que ya existían en la base —los de `AgendaOutcome` al ejecutar una
 * agendada y los de `VisitOutcome` al registrar una visita—, así que lo nuevo que se escriba **se lee igual** que
 * lo anterior en el historial.
 */
export const RECOVERY_RESULTS = ['CONTACTED', 'NO_ANSWER', 'WRONG_NUMBER', 'NOT_FOUND', 'WRONG_ADDRESS', 'REFUSAL', 'PROMISE_TO_PAY'] as const;
export type RecoveryResult = (typeof RECOVERY_RESULTS)[number];

/** El resultado que significa «prometió pagar»: exige la promesa, y la promesa lo exige. */
export const PROMISE_RESULT: RecoveryResult = 'PROMISE_TO_PAY';

/**
 * Qué resultados tienen sentido para cada tipo: «no lo encontró» es de una visita, «número equivocado» es de una
 * llamada o un mensaje. Una nota no tiene resultado: es lo que alguien quiso dejar dicho.
 */
export const RECOVERY_RESULTS_BY_TYPE: Record<RecoveryActivityType, readonly RecoveryResult[]> = {
  CALL: ['CONTACTED', 'NO_ANSWER', 'WRONG_NUMBER', 'REFUSAL', 'PROMISE_TO_PAY'],
  MESSAGE: ['CONTACTED', 'NO_ANSWER', 'WRONG_NUMBER', 'REFUSAL', 'PROMISE_TO_PAY'],
  VISIT: ['CONTACTED', 'NOT_FOUND', 'WRONG_ADDRESS', 'REFUSAL', 'PROMISE_TO_PAY'],
  NOTE: [],
};

export const RECOVERY_NOTES_MAX_LENGTH = 1000;

export interface RecoveryActivityInput {
  /** Lo pone el móvil para que reintentar sin red no duplique la gestión. */
  id?: string;
  type: string;
  result?: string;
  notes?: string;
  promise?: { amount: number; promiseDate: string; paymentMethodCode: string; bankCode?: string };
}

/** Por qué una gestión no es válida. Es un código, no una frase: cada lado la dice en su idioma. */
export type RecoveryActivityError =
  | 'TYPE_INVALID'
  | 'NOTES_REQUIRED'
  | 'NOTES_TOO_LONG'
  | 'RESULT_REQUIRED'
  | 'RESULT_NOT_ALLOWED'
  | 'PROMISE_REQUIRED'
  | 'PROMISE_NOT_ALLOWED'
  | 'PROMISE_AMOUNT_INVALID'
  | 'PROMISE_DATE_INVALID'
  | 'PROMISE_DATE_PAST'
  | 'PROMISE_METHOD_REQUIRED';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `null` = válida. `today` es el día civil (`YYYY-MM-DD`) contra el que se compara la fecha prometida: la zona
 * horaria es de quien llama (el panel pasa el día local de quien escribe; la API deja un día de margen para que
 * alguien en Bolivia a las 21:00 pueda prometer «hoy» cuando en UTC ya es mañana).
 *
 * Las reglas, en orden:
 *  · una **nota** sólo lleva texto: ni resultado ni promesa;
 *  · una llamada, visita o mensaje **exige resultado**, y uno que corresponda a su tipo;
 *  · **«promesa de pago» y la promesa van juntas**: el resultado sin los datos de la promesa dejaría una promesa
 *    que nadie va a poder seguir, y los datos de una promesa con otro resultado se contradicen.
 */
export function validateRecoveryActivity(input: RecoveryActivityInput, today: string): RecoveryActivityError | null {
  if (!(RECOVERY_ACTIVITY_TYPES as readonly string[]).includes(input.type)) return 'TYPE_INVALID';
  const type = input.type as RecoveryActivityType;
  const notes = input.notes?.trim() ?? '';
  if (notes.length > RECOVERY_NOTES_MAX_LENGTH) return 'NOTES_TOO_LONG';

  if (type === 'NOTE') {
    if (input.result) return 'RESULT_NOT_ALLOWED';
    if (input.promise) return 'PROMISE_NOT_ALLOWED';
    return notes.length === 0 ? 'NOTES_REQUIRED' : null;
  }

  if (!input.result) return 'RESULT_REQUIRED';
  if (!RECOVERY_RESULTS_BY_TYPE[type].includes(input.result as RecoveryResult)) return 'RESULT_NOT_ALLOWED';

  const promises = input.result === PROMISE_RESULT;
  if (promises && !input.promise) return 'PROMISE_REQUIRED';
  if (!promises && input.promise) return 'PROMISE_NOT_ALLOWED';
  if (!input.promise) return null;

  const { amount, promiseDate, paymentMethodCode } = input.promise;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return 'PROMISE_AMOUNT_INVALID';
  if (!DAY.test(promiseDate) || Number.isNaN(Date.parse(`${promiseDate}T00:00:00Z`))) return 'PROMISE_DATE_INVALID';
  if (promiseDate < today) return 'PROMISE_DATE_PAST';
  if (!paymentMethodCode?.trim()) return 'PROMISE_METHOD_REQUIRED';
  return null;
}
