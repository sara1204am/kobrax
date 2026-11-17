# F15 · HANDOFF

## Sesión 2026-11-13
- **Hecho:** plan v2 → v3 alineado a F4–F9 y a los ajustes de UI (§0 del plan). Decisiones aprobadas por la usuaria: O-5 (ola 1a), D-8 (Seguridad troncal), D-9 (Actividad ocultable con 1 miembro). G4 primer intento: **FAIL** (5 ítems); corregidos: citas, HUB e IMPACT-MAP creados (`H15-001…025`), IDs de reglas, regresión del gratuito individual (R-1, 12 flujos de `F13/target/09`), cruce con el móvil (D1). Creados `README`, `STATUS`, `RULES`, `HANDOFF`.
- **Pedido de la usuaria al cierre:** diseñar en HTML cómo se verá el workspace antes de tocar código.
- **Sin código de producto, sin rama.** Lo de `docs/epics/F15/` no está commiteado (nunca `git add docs`; rutas explícitas).
- **Siguiente paso autorizado:** repetir el G4 sobre la v3. Después, solo con orden de la usuaria, abrir `f15/p1-contrato-api` desde `dev`.
- **Trampas:** el filtro de Planificar rutas mira el rol `COLLECTOR` (P-2 debería filtrar por permiso); `credit-form.ts` lo importa el móvil; el merge de `configuration` en `accounts.service.ts:188` solo corre con `preferences` o `billing`.

## Ampliación 2026-11-13 (tarde)
- **Hecho:** propuesta de onboarding y aprendizaje (`PROPUESTA-onboarding-y-aprendizaje.md`) con **D-10 a D-18 aprobadas**: dentro de F15 (fases P5–P10), asistente de 8 pasos, recomendación por plan solo como sugerencia, estado de guías en el servidor en la tabla nueva `user_guide_states` (única migración de F15), asistente solo para administradores de cuentas nuevas tras MFA, sin sugerencias, Centro de ayuda dentro, móvil/videos/guías de la ola 1b fuera, **recorrido con spotlight por todo el menú y la barra superior**. HUB `H15-026…034` e IMPACT-MAP ampliados; plan, STATUS y RULES al día.
- **Maqueta interactiva** (5 pantallas, incluido el recorrido): https://claude.ai/artifact/NP7wYGNCPPecxh6zxRfT5t
- **G4 de P1–P4: PASS 2026-11-13** (confirmado por la usuaria; maqueta aprobada). **Siguiente paso:** la orden de abrir `f15/p1-contrato-api` desde `dev`. Pendiente aparte: mergear los PR #35 y #36 y cambiar las contraseñas demo de producción.
- **Sin código, sin rama.** `docs/epics/F15/` sigue sin commitear.

## Implementación 2026-11-14 (la usuaria ordenó «implementa hasta el final»)
- **P1 hecha** (`f15/p1-contrato-api`, `81a6ed2`): `shared/utils/workspace.ts`, `PATCH /accounts/me` con `workspace` (rev, 409, 422, salvaguardas S-1/S-2/S-3/S-7, auditoría del subárbol), `workspace` en `/accounts/me` y `/auth/me`. Integración real 12/12.
- **P2 hecha** (`f15/p2-web-navegacion`, `3837d37`, sobre p1): menú filtrado, `requireModuleVisible` en 6 layouts, `WorkspaceProvider`, avisos `?oculto=`, enlaces resueltos. Prueba real con `next start` (`apps/api/test/integration/p2-web-guard.real.ts`, 25 comprobaciones).
- **Hallazgos útiles para quien siga:** el guard responde 200 con `<meta refresh>` y no 307 (el `loading.tsx` transmite por partes); el ítem Seguridad no se pinta como enlace `/seguridad` en el menú (es un grupo); los heredocs largos en la shell fallan (usar la herramienta de archivos para scripts).
- **Siguiente:** P-2, P3, P4 (cada una en su rama desde la anterior), luego G4 propio de P5+ si la usuaria lo ordena.

## Cierre de la ola 1a (2026-11-14)
- **P1, P2, P-2, P3 y P4 construidas y commiteadas en local**, ramas encadenadas (`81a6ed2` → `3837d37` → `eafedd7` → `7fcd59f` → `cedb371`). Evidencia en `execution/VERIFICATIONS.md` (V-001…V-026). Totales: shared 542, API unitarias 2117, web 1399, integración real `f15-workspace` 12/12, `f15-p2-planificar` 4/4, `f15-p3-alta` 6/6, y la verificación real de la web `p2-web-guard.real.ts` (31 comprobaciones con `next start`).
- **Antes de subir:** probar a mano en un navegador (menú, aviso, pestaña, preset «Independiente», alta de crédito con cuota acordada) y la regresión R-1 del gratuito individual con interfaz (`F13/target/09`); no se corrió la integración completa de la API (~30 min por modo) ni las pruebas del móvil (solo `tsc`).
- **Cosas que no son obvias:** el guard responde 200 con `<meta refresh>` (no 307) por el `loading.tsx`; el HTML del servidor de Cuenta no trae los enlaces de sus pestañas; la opción `client.taxId` no tiene efecto visible (el NIT es solo de lectura en web); un NIT, garante, ingreso o adjunto ya guardado nunca se esconde (R7); `prettier --write` es seguro sobre estos archivos (cumplían prettier).
- **Siguiente (solo con orden de la usuaria):** push de las ramas y PR a `dev`; luego P5–P10 (onboarding, recorrido con spotlight, guías y `/ayuda`), cada una con su plan y su G4. Pendientes aparte: PR #35 y #36, contraseñas demo de producción.


## Sesión 2026-11-14 (continuación)
- **Push** de las ramas p1…p4 a `origin` (orden de la usuaria). Sin PR.
- **P5 hecha** (`f15/p5-catalogo-guias`, commit local): `utils/guides.ts` (recorrido general de 14 módulos + 5 elementos de la barra, guías de pantalla de 7 módulos, ayuda), `utils/recommend-setup.ts` (Free→independent, Professional→team, Business→complete, resto→independent). Q-1: textos solo en `apps/web/messages`, `shared` lleva claves; Q-2: cifras 12/18 son orientación. Evidencia V-027…V-031.
- **Trampa:** la suite de la web (136 archivos) falla con `[MSW] intercepted a request without a matching request handler` si la máquina va cargada; repetida sin carga pasa 1399/1399. Para ver el resumen, redirigir la salida a un archivo (un `| grep` la deja vacía hasta el final).
- **Siguiente (solo con orden de la usuaria):** push de p5 y PR a `dev`; luego plan y G4 de P6 (migración `user_guide_states`, snapshot de puertas con aprobación expresa).

## P8 y P9 (2026-11-14)
- P8 commit `615eafb`; P9 en `f15/p9-spotlight-recorrido`. Detalle en plans/P9. Falta probar el recorrido en un navegador real. Siguiente: P10 (guías de pantalla y /ayuda).

## P10 (2026-11-14)
- Construida sobre p9 (commit propio). Anclas faltantes en plans/P10. Todo F15 (P1–P10) está construido en local; falta navegador real y push/PR de p5–p10.
