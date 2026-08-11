/**
 * Qué hacer para que el server quede como el formulario (Cartera S5).
 *
 * ⚠️ **Se mudó a `@kobrax/shared`** (F9 · W3), junto con `cliente-form`: la web edita el mismo
 * cliente contra los mismos endpoints, y mandar sólo lo que cambió no es cosmética —los
 * sub-recursos tienen cada uno su ruta—. Este archivo re-exporta para no tocar a quien ya lo
 * importaba. `hasChanges` allá se llama `hasClientChanges`, porque `patch.ts` (W2) ya usaba ese
 * nombre para el diff de campos escalares.
 */
export { diffCliente, hasClientChanges as hasChanges, type ClienteOps, type RowOps } from '@kobrax/shared';
