/**
 * Lógica pura del alta de préstamo (V2, §4.1/§4.2/§5.2). El panel Cuota/Total/Ganancia sale de
 * `quoteLoan` de shared (misma matemática que el PDF); la cuota se **congela** al guardar (D1/D2).
 *
 * ⚠️ **Se mudó a `@kobrax/shared`** (F9 · W3). Es plata: la supervisora cotiza el mismo préstamo
 * desde el panel web, y dos implementaciones dan dos cuotas para los mismos datos. Este archivo
 * re-exporta para no tocar a quien ya lo importaba.
 */
export {
  buildPrestamoPayload,
  canSubmitPrestamo,
  currentInstallment,
  initialPrestamo,
  quoteFor,
  totalBelowCapital,
  type LoanMode,
  type PrestamoForm,
} from '@kobrax/shared';
