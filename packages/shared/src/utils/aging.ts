/**
 * Los tramos de mora del dashboard.
 *
 * 🔴 **Van acá y no en cada app** porque son la misma regla en dos lados: la API corta los créditos
 * por estos bordes y el panel rotula las porciones. Si cada uno tuviera su copia, un día la API
 * pondría el 450 en un tramo y el gráfico lo rotularía en otro — y el número seguiría *pareciendo*
 * correcto.
 *
 * ⚠️ Llevan **código, no rótulo**: el panel es bilingüe y el texto vive en `messages/{es,en}.json`.
 * Es la misma regla que dejó W2 — a `shared` va la regla, nunca el texto en un idioma.
 */

/** `max: null` = sin techo. Los bordes son los del pedido: 1-30 · 31-90 · 91-180 · 181-360 · 361-450 · >450. */
export const AGING_BUCKETS = [
  { code: 'D1_30', min: 1, max: 30 },
  { code: 'D31_90', min: 31, max: 90 },
  { code: 'D91_180', min: 91, max: 180 },
  { code: 'D181_360', min: 181, max: 360 },
  { code: 'D361_450', min: 361, max: 450 },
  { code: 'D450_PLUS', min: 451, max: null },
] as const;

export type AgingBucketCode = (typeof AGING_BUCKETS)[number]['code'];

/**
 * En qué tramo cae una mora.
 *
 * 🔴 **Sin mora no hay tramo, y no es lo mismo que el primero.** Un crédito al día tiene
 * `daysPastDue = 0`; meterlo en «1-30 días» infla el tramo más chico con la cartera sana y el
 * gráfico deja de decir nada. Devuelve `null` y quien llama decide si lo cuenta aparte o lo ignora.
 */
export function agingBucket(daysPastDue: number): AgingBucketCode | null {
  if (!Number.isFinite(daysPastDue) || daysPastDue < 1) return null;
  const found = AGING_BUCKETS.find((b) => daysPastDue >= b.min && (b.max === null || daysPastDue <= b.max));
  return found ? found.code : null;
}
