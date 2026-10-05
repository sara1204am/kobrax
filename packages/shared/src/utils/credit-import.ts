/**
 * Créditos importados (F4/06 · Fase 4): qué datos trajo el archivo y cuáles no.
 *
 * 🔴 **Desconocido no es cero (D9).** Algunas columnas del crédito son `NOT NULL` (capital, tasa, saldo,
 * mora, nº de cuotas), así que cuando el archivo no trae el dato la base guarda un 0 que **no significa
 * nada**. La verdad está en `metadata.importMissing`: la lista de campos que ningún archivo trajo. Quien
 * dibuja un crédito pregunta acá antes de pintar «Bs 0», «Mensual» o «Préstamo abierto».
 */

/** Los datos financieros de un crédito que un archivo puede traer, o no. */
export const IMPORT_TRACKED_FIELDS = [
  'principalAmount',
  'outstandingBalance',
  'interestRate',
  'installmentAmount',
  'installmentsCount',
  'frequency',
  'nextDueDate',
  'disbursedAt',
  'daysPastDue',
] as const;

export type ImportTrackedField = (typeof IMPORT_TRACKED_FIELDS)[number];

export function isImportTrackedField(v: unknown): v is ImportTrackedField {
  return typeof v === 'string' && (IMPORT_TRACKED_FIELDS as readonly string[]).includes(v);
}

/**
 * Qué sigue sin conocerse después de un archivo.
 *
 *  · alta (`previous` = `undefined` y `isNew`) → lo que este archivo no trajo;
 *  · actualización → lo que faltaba **y** este archivo tampoco trajo. Un dato conocido no se vuelve
 *    desconocido porque el próximo archivo no lo traiga: el importador no lo pisa, así que sigue valiendo.
 *  · crédito importado antes de la Fase 4 (sin lista) → se toma lo que este archivo no trae: con el
 *    mismo formato de archivo, es lo que nunca se trajo. Sin esa suposición seguiría mostrando ceros.
 */
export function nextImportMissing(
  previous: readonly ImportTrackedField[] | undefined,
  present: Partial<Record<ImportTrackedField, boolean>>,
): ImportTrackedField[] {
  const absentNow = IMPORT_TRACKED_FIELDS.filter((f) => !present[f]);
  if (!previous) return absentNow;
  return absentNow.filter((f) => previous.includes(f));
}

/** ¿Este dato del crédito es desconocido? Sólo un importado puede tener desconocidos. */
export function isUnknownField(credit: { unknownFields?: readonly string[] }, field: ImportTrackedField): boolean {
  return credit.unknownFields?.includes(field) ?? false;
}

/** Cuántos de los datos financieros trajo el archivo, para la ficha: «6 de 9». */
export function importCompleteness(unknownFields: readonly string[] | undefined): { known: number; total: number } {
  const total = IMPORT_TRACKED_FIELDS.length;
  const unknown = IMPORT_TRACKED_FIELDS.filter((f) => unknownFields?.includes(f)).length;
  return { known: total - unknown, total };
}
