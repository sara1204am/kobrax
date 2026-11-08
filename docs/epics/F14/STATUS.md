# F14 · STATUS

> Estado vivo de la épica. Gates: definición en `../F13/GATES.md` (mismo vocabulario PASS · FAIL · BLOCKED · NOT_APPLICABLE).

| Gate | Estado | Justificación / fuente |
|---|---|---|
| G0 Arnés | **PASS mínimo** | README, STATUS, RULES, HANDOFF, `hub/HUB.md`, `plans/`, `execution/VERIFICATIONS.md`. `GATES.md` se remite a F13. |
| G1 Discovery | PASS por equivalencia | `ROLES-PERMISOS-AUDITORIA.md` + `ROLES-PERMISOS-ENDPOINTS.md` + §B del plan (hallazgos con evidencia). |
| G2 Arquitectura | PASS por equivalencia | `ROLES-PERMISOS-PLAN.md` §C; decisiones H-1…H-13 **APROBADAS por la usuaria 2026-11-04** (tabla §H). |
| G3 Roadmap | PASS por equivalencia | `ROLES-PERMISOS-PLAN.md` §E (fases 0–9). La usuaria ordenó «empieza F1» y autorizó avanzar entre fases (2026-11-04). |
| G4 Plan de F1 | **PASS 2026-11-05** | `plans/F1-sesiones-aislamiento.md` validado (11/11); D-1, D-2, D-5 aprobadas por la usuaria. Primer intento: FAIL en ítem 4 por esas tres decisiones. |

| G4 Plan de F3 | **PASS 2026-11-05** | `plans/F3-authz-core.md` validado 11/11; D-1…D-5 aprobadas por la usuaria; HUB H14-019…024 y IMPACT-MAP creados. Advertencias: conteo de handlers aproximado (lo fija la tarea 1); E9 (orden de guards) es INFERIDO y se prueba en la tarea 4. |
| G5 Verificación de F3 | **PASS 2026-11-05** | V-015…V-021: API 1926/1926, integración 201/201, web 1244, móvil 979, `tsc` limpio. Snapshot `authz-snapshot.json` (203 handlers) aprobado por la usuaria («continúa» tras pedírselo). |
| G6 `/code-review` de F3 | **PASS 2026-11-05** | V-020: 10 hallazgos, 7 corregidos, 3 descartados/aceptados con motivo. Recorrido de IMPACT-MAP por H14-019…024 hecho (sin dependientes sin cubrir). |
| G7 Cierre de F3 | **PASS 2026-11-05** | HUB, STATUS, HANDOFF, VERIFICATIONS y `docs/producto/roles-permisos-planes.md` actualizados. **F2 no se abre.** |
| G5 Verificación de F1 | **PASS 2026-11-05** | V-001…V-014: API 1896/1896, integración 178/178, web 1244/1244, móvil 979/979, `tsc` limpio en api/web/database/mobile. Las dos fallas ajenas (`route-lifecycle`, `tsc` móvil) se resolvieron (V-010, V-011). |
| G6 `/code-review` | **PASS 2026-11-05** | V-014: 9 hallazgos, 5 corregidos, 2 descartados con motivo, 2 aceptados y documentados. Recorrido de IMPACT-MAP por las entradas HUB H14-001…018 hecho en `hub/HUB.md`. |
| G7 Cierre de F1 | **PASS 2026-11-05** | HUB, STATUS, HANDOFF, VERIFICATIONS, INCIDENTS y `docs/producto/roles-permisos-planes.md` actualizados. Registro de fases: esta tabla (F14 no tiene PHASES-LOG propio). **F2 no se abre.** |

| G4 Plan de F2 | **PASS 2026-11-05 (2.º intento)** | `plans/F2-responsabilidad-alcance.md` validado 11/11; D-1…D-6 aprobadas; HUB H14-025…031 (+027b) e IMPACT-MAP. 1.er intento FAIL por el cruce móvil (ítem 10), corregido en §8.1. Advertencias: el comentario `agenda.service.ts:291` dice que el cobrador no tiene `client:write` y `permissions.ts` se lo da (CONTRADICTORIO: manda el catálogo; comentario viejo); «`otherCredits` lo ignora el móvil» es INFERIDO y se prueba en la tarea 9. |

| G5 Verificación de F2 | **PASS 2026-11-05** | V-022…V-028: API 1978, integración por tandas (V-024), web 1252, móvil 979, `tsc` limpio. Snapshot de puertas aprobado por la usuaria («ok»): `POST /clients`→`client:create`, `POST /credits`→`credit:create`, `DELETE /clients/:id`→`client:delete` (destructivo). |
| G6 `/code-review` de F2 | **PASS 2026-11-05** | V-029: 8 hallazgos, 5 corregidos, 2 declinados con motivo, 1 a decisión de la usuaria. |
| G7 Cierre de F2 | **PASS 2026-11-05** | HUB H14-025…031 (+027b) HECHO, VERIFICATIONS, HANDOFF y `docs/producto/roles-permisos-planes.md` actualizados. **F2b, F4 y el móvil no se abren.** |

| G4 Plan de F2b | **PASS 2026-11-05** | `plans/F2b-barrera-rls-alcance.md` validado 11/11; D-1…D-5 aprobadas por la usuaria; HUB H14-032…036 e IMPACT-MAP creados. Advertencias: la regla exacta de pagos, agenda y rutas por alcance y el rol dueño de las funciones `SECURITY DEFINER` son DESCONOCIDOS hasta la tarea 1 (inventario), que puede cambiar el alcance; el número de llamadores de `withTenant` sin contexto es INFERIDO. |

## Autorizaciones de la usuaria (2026-11-04)
- Avanzar entre fases sin esperarla; `prisma migrate reset` permitido (su DB dev es de prueba).
- Commits locales por fase; **sin push/PR** hasta que lo pida.
- No usar el modelo Fable en agentes nuevos.

## Fase vigente
**F2b · Plan VALIDADO** (rama `f14/p2b-barrera-rls-alcance`, `plans/F2b-barrera-rls-alcance.md`, G4 PASS 2026-11-05), D-1…D-5 aprobadas; espera `ejecuta F2b`. Sin código. F2 cerrada.  
(Texto previo:) **F2 · CERRADA 2026-11-05** (rama `f14/p2-responsabilidad-alcance`, commit local, sin push/PR). Ninguna fase abierta: F2b (barrera RLS de alcance) y F4 esperan la orden de la usuaria. El móvil queda pendiente (se refactorizará).  
(Texto previo:) **F2 · Plan en borrador** (rama `f14/p2-responsabilidad-alcance`, commit `18c4f44`), D-1…D-6 aprobadas; la barrera RLS pasó a F2b. Sin código. F3 cerrada.  
(Lo siguiente es el texto previo de F3, ya cerrada:) **F3 · Arquitectura central de autorización** (rama `f14/p3-authz-core`). Plan `plans/F3-authz-core.md` (G4 PASS). **Construida y CERRADA 2026-11-05** (G4–G7 PASS). Orden aprobado F1 → F3 → F2 (F2 depende de F3). F1 cerrada 2026-11-05.

| G5 Verificación de F2b | **PASS 2026-11-06** | V-031…V-037. Barrera instalada y probada (integración 250/250 en `off` y en `enforce`; suite de la barrera 21/21; `verify_scope.sql` 6/6; unitarias 1986/1986; web 1252/1252). **D-4 (V-035) contra la línea base real —policies NO instaladas—:** escenario realista (180 000 créditos, ≈150 cobradores) **dentro del presupuesto** (HTTP ×0,34–0,94, un solo ruido ×1,29; SQL +0…+7 ms); `off` sin costo. **Peor caso (un cobrador con la tercera parte de la cartera): ×1,5–1,7** en sus dos listados principales — documentado. Por la decisión de la usuaria (2026-11-06) `SCOPE_RLS_MODE=off` sigue por defecto; `enforce` NO se activa hasta nueva orden. |

| G6 `/code-review` de F2b | **PASS 2026-11-06** | V-038: 10 hallazgos, 9 corregidos, 1 aceptado con motivo (backfill sin lotes: aún sin datos de producción). Recorrido de IMPACT-MAP por H14-032…036 hecho. |
| G7 Cierre de F2b | **PASS 2026-11-06** | HUB H14-032…036 HECHO (H14-034 PARCIAL: la paridad TS↔SQL la cubre la integración), VERIFICATIONS V-031…V-038, INCIDENTS, HANDOFF y `docs/producto/roles-permisos-planes.md` al día. **`enforce` NO se activa** (decisión de la usuaria: `SCOPE_RLS_MODE=off` por defecto hasta nueva orden). **F4 no se abre** sin su orden. |

| G4 Plan de F4 | **PASS 2026-11-06** | `plans/F4-pii-archivos.md` validado 11/11; D-1…D-3 aprobadas por la usuaria (tabla `files` + enlaces firmados ahora; CI en móvil tras interruptor apagado hasta F8; supervisor con CI enmascarado por defecto); D-4…D-6 derivadas de H-5/H-6 y ADR-F14-06/07; HUB H14-037…045 e IMPACT-MAP creados. La usuaria ordenó seguir F4→F5→F6→F7 «hasta el final». |

| G5 Verificación de F4 | **PASS 2026-11-07** | V-039…V-041: unitarias API 2005 / shared 474 / web 1253; `f4-pii-archivos.it.ts` 18/18; integración completa en `off` y en `enforce` sin fallos; `verify_files` 3/3 y `verify_scope` 6/6; `tsc` limpio. Regresión del perfil gratuito individual incluida. **Snapshot de puertas** regenerado (3 endpoints nuevos —uno público, el enlace firmado— y 3 guardas con `client:contact:read`): aprobado por la orden de la usuaria de seguir F4→F7; queda señalado en HANDOFF para su revisión. |
| G6 `/code-review` de F4 | **PASS 2026-11-07** | 10 hallazgos, 8 corregidos (permiso sin migración de datos; enlace firmado que no funcionaba desde la web; carrera limpieza/re-subida; archivo borrado que no revivía; contactos tapados por el interruptor del móvil; PDF del supervisor con documento en claro; auditoría de Agenda sin revelado; plazo de 24 h medido desde la primera subida), 1 aceptado con motivo (canal por encabezado, apagado), 1 de mantenimiento corregido. |
| G7 Cierre de F4 | **PASS 2026-11-07** | HUB H14-037…045 HECHO, STATUS, HANDOFF, VERIFICATIONS, INCIDENTS y `docs/producto/roles-permisos-planes.md` al día. Por la orden vigente de la usuaria (seguir F4→F7) la siguiente fase es F5. |

| G4 Plan de F5 | **PASS 2026-11-07** | `plans/F5-roles-por-cuenta.md` validado 11/11; D-1 aprobada por la usuaria (F5 incluye la plataforma); D-2…D-7 derivadas de H-1, H-4, H-5, H-9, H-11, H-13; HUB H14-046…053 e IMPACT-MAP creados. |
| G5 Verificación de F5 | **PASS 2026-11-07** | V-042…V-044: unitarias API 2025/2025; `f5-roles-plataforma.it.ts` 17/17; integración completa en `off` y `enforce` (285 pruebas) sin fallos tras ajustar `agenda-route.it.ts` al rol por cuenta; web `vitest` 1258/1258; `tsc` limpio en api y web. |
| G6 `/code-review` de F5 | **PASS 2026-11-07** | Correcciones aplicadas (commit `94eae2f`): lectura de PII de soporte exige consentimiento; sesión rechazada o retirada no da token; `decide`/`revoke` atómicos; bloqueo tras 5 fallos y TOTP no reutilizable en el login de plataforma; permisos fallan cerrado si el rol de cuenta no existe; persona de plataforma inactiva rechazada; `support_session` en Actividad; enums nativos. Hallazgo 10 (transacción extra por login) aceptado con motivo. |
| G7 Cierre de F5 | **PASS 2026-11-07** | HUB H14-046…053 HECHO, STATUS, HANDOFF, VERIFICATIONS, INCIDENTS y `docs/producto/roles-permisos-planes.md` al día. Siguiente por orden vigente: F6 (navegación web por permisos); se abre solo con `plan F6`. |
