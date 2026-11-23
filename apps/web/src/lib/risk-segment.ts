/**
 * El segmento de riesgo del deudor. El motor de prioridad de Mora sólo entiende estos tres (`LOW`/`MEDIUM`/`HIGH`, ver
 * `arrears-priority-score.ts`): cualquier otro texto suma 0, sin avisar. Por eso se elige de una lista y no se escribe.
 */
export const RISK_SEGMENTS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskSegment = (typeof RISK_SEGMENTS)[number];

/** El valor guardado → uno de los tres (sin importar mayúsculas), o `null` si es un texto libre de antes. */
export function riskSegmentOf(value: string | null | undefined): RiskSegment | null {
  const v = (value ?? '').trim().toUpperCase();
  return (RISK_SEGMENTS as readonly string[]).includes(v) ? (v as RiskSegment) : null;
}
