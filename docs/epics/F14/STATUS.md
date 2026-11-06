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

## Autorizaciones de la usuaria (2026-11-04)
- Avanzar entre fases sin esperarla; `prisma migrate reset` permitido (su DB dev es de prueba).
- Commits locales por fase; **sin push/PR** hasta que lo pida.
- No usar el modelo Fable en agentes nuevos.

## Fase vigente
**F2 · CERRADA 2026-11-05** (rama `f14/p2-responsabilidad-alcance`, commit local, sin push/PR). Ninguna fase abierta: F2b (barrera RLS de alcance) y F4 esperan la orden de la usuaria. El móvil queda pendiente (se refactorizará).  
(Texto previo:) **F2 · Plan en borrador** (rama `f14/p2-responsabilidad-alcance`, commit `18c4f44`), D-1…D-6 aprobadas; la barrera RLS pasó a F2b. Sin código. F3 cerrada.  
(Lo siguiente es el texto previo de F3, ya cerrada:) **F3 · Arquitectura central de autorización** (rama `f14/p3-authz-core`). Plan `plans/F3-authz-core.md` (G4 PASS). **Construida y CERRADA 2026-11-05** (G4–G7 PASS). Orden aprobado F1 → F3 → F2 (F2 depende de F3). F1 cerrada 2026-11-05.
