# F14 · STATUS

> Estado vivo de la épica. Gates: definición en `../F13/GATES.md` (mismo vocabulario PASS · FAIL · BLOCKED · NOT_APPLICABLE).

| Gate | Estado | Justificación / fuente |
|---|---|---|
| G0 Arnés | **PASS mínimo** | README, STATUS, RULES, HANDOFF, `hub/HUB.md`, `plans/`, `execution/VERIFICATIONS.md`. `GATES.md` se remite a F13. |
| G1 Discovery | PASS por equivalencia | `ROLES-PERMISOS-AUDITORIA.md` + `ROLES-PERMISOS-ENDPOINTS.md` + §B del plan (hallazgos con evidencia). |
| G2 Arquitectura | PASS por equivalencia | `ROLES-PERMISOS-PLAN.md` §C; decisiones H-1…H-13 **APROBADAS por la usuaria 2026-11-04** (tabla §H). |
| G3 Roadmap | PASS por equivalencia | `ROLES-PERMISOS-PLAN.md` §E (fases 0–9). La usuaria ordenó «empieza F1» y autorizó avanzar entre fases (2026-11-04). |
| G4 Plan de F1 | **PASS 2026-11-05** | `plans/F1-sesiones-aislamiento.md` validado (11/11); D-1, D-2, D-5 aprobadas por la usuaria. Primer intento: FAIL en ítem 4 por esas tres decisiones. |

| G5 Verificación de F1 | **PARCIAL** | V-001…V-009 en `execution/VERIFICATIONS.md`: API 1892/1892, integración nueva 6/6, web 1244/1244, móvil 13/13. FAIL ajeno: `route-lifecycle.it.ts` (INCIDENTS) y `tsc` del móvil. Decidir si se tratan antes de cerrar. |
| G6 `/code-review` | PENDIENTE | No corrido. |
| G7 Cierre de F1 | PENDIENTE | HUB actualizado; falta PHASES-LOG y docs de producto. |

## Autorizaciones de la usuaria (2026-11-04)
- Avanzar entre fases sin esperarla; `prisma migrate reset` permitido (su DB dev es de prueba).
- Commits locales por fase; **sin push/PR** hasta que lo pida.
- No usar el modelo Fable en agentes nuevos.

## Fase vigente
**F1 · Sesiones y aislamiento** (rama `f14/p1-sesiones-aislamiento`, en ejecución desde 2026-11-05). Resuelve R-01, R-02, N-04, N-12, R-06 (mínimo).
