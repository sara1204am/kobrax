# F13 · Planes de fase

> **Vacío a propósito.** Un plan se crea **al empezar su fase** (convención just-in-time de `../../F10/BUILD-PLAN.md` §1), nunca por adelantado.
> Condición para crear el primero: G3 PASS.

## Cómo se crea y valida un plan
1. `/epic-fase F13 plan <fase>` → copia la plantilla T4 (`../../_framework/TEMPLATES.md`) a `plans/<fase>-<nombre>.md`.
2. El estado inicial se **relee hoy contra el código**; no se copia de discovery.
3. Se consultan las entradas HUB de los archivos afectados.
4. Se itera con la usuaria hasta darlo por completo.
5. `/epic-fase F13 validar <fase>` → PASS/FAIL (checklist en el skill). Sin PASS no hay rama ni código (G4).
6. Cabecera de estado: `> ESTADO: BORRADOR | VALIDADO (PASS fecha) | EN EJECUCIÓN | CERRADO`.

## Cómo se pausa
Igual que en F10: dejar el borrador guardado con `> ESTADO: BORRADOR — ronda N (fecha). NO construir hasta PASS.` y una sección «Pendiente de confirmar»; actualizar `../HANDOFF.md`.

## Planes existentes
_(ninguno)_
