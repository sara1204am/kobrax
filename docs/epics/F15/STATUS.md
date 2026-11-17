# F15 · STATUS

> Estado vivo de la épica «Configurable Workspace». Gates: vocabulario de `../F13/GATES.md` (PASS · FAIL · BLOCKED · NOT_APPLICABLE).

| Gate | Estado | Justificación / fuente |
|---|---|---|
| G0 Arnés | **PASS mínimo (2026-11-13)** | `README`, `STATUS`, `RULES`, `HANDOFF`, `hub/HUB.md`, `hub/IMPACT-MAP.md`. |
| G1 Discovery | PASS por equivalencia | `MATRIZ-simplificacion-interna.md` (tres lecturas de código del 2026-11-06 + correcciones C-1..C-15). |
| G2 Arquitectura | PASS por equivalencia | `PLAN-MVP-configurable-workspace.md` §5; D-1, D-3…D-9, O-2, O-3, O-5 aprobadas por la usuaria. |
| G3 Roadmap | PASS por equivalencia | Plan §13: P1 → P2 → P-2 → P3 → P4. |
| G4 Plan MVP (1.er intento) | **FAIL 2026-11-13** | 5 ítems: citas desfasadas, HUB inexistente, IDs de reglas, regresión del gratuito individual, cruce móvil (D1). |
| G4 Plan MVP · P1–P4 (2.º intento) | **PASS 2026-11-13** | Validado 11/11 por la usuaria («ya está confirmado»). 38 citas releídas hoy, 0 desfasadas; 0 «TBD»; ninguna decisión en PROPUESTA; los 19 archivos del §7 tienen entrada HUB (34 entradas `H15-001…034`) e IMPACT-MAP; IDs de reglas, regresión del gratuito individual (R-1) y cruce con el móvil (D1) registrados. **Advertencias:** 13 entradas del HUB están `SEMBRADO` (se releen en el G4 de su fase); el bloque de contrato de §5 es un esquema de datos, no código; P5–P10 no tienen plan de fase todavía (se escriben just-in-time). |

| Propuesta de onboarding y aprendizaje | **Aprobada 2026-11-13** | `PROPUESTA-onboarding-y-aprendizaje.md`: D-10 a D-18 aprobadas por la usuaria. Cada fase P5–P10 trae su plan just-in-time y su propio G4. |

## Fase vigente
**Ninguna abierta.** Plan v3 **VALIDADO** para P1–P4 (G4 PASS 2026-11-13), sin rama ni código. Siguiente paso: la usuaria ordena abrir `f15/p1-contrato-api` desde `dev` (no se abre sin esa orden). Las fases P5–P10 no se planifican hasta cerrar P4.

## Fases construidas (2026-11-14)
| Fase | Rama | Commit local | Gates |
|---|---|---|---|
| P1 contrato `workspace` en shared y API | `f15/p1-contrato-api` | `81a6ed2` | G5 PASS (V-001…V-009), G6 PASS (9 hallazgos: 5 corregidos, 4 declinados con motivo) |
| P2 navegación web (menú, guard, avisos, enlaces) | `f15/p2-web-navegacion` (sobre p1) | `3837d37` | G5 PASS (V-010…V-013 con prueba real), G6 PASS (7 hallazgos: 5 corregidos, 2 declinados, 1 sin aplicar) |

| P-2 planificarse la ruta a uno mismo | `f15/p-2-planificar-propio` (sobre p2) | `eafedd7` | G5 PASS (V-015, V-016 con integración real), revisión manual |
| P3 opciones de crédito y cliente | `f15/p3-opciones-credito-cliente` (sobre p-2) | `7fcd59f` | G5 PASS (V-017…V-020 con API real), G6 PASS (8 hallazgos: 4 corregidos, 4 declinados) |
| P4 pestaña Espacio de trabajo, presets y restablecer | `f15/p4-pestana-presets` (sobre p3) | `cedb371` | G5 PASS (V-022…V-025 con BFF real), G6 PASS (8 hallazgos: 2 corregidos, 6 declinados) |

**Ola 1a (P1–P4) construida.** Sin push ni PR (orden de la usuaria). Las cinco ramas están encadenadas: `p1 → p2 → p-2 → p3 → p4`; un PR a `dev` desde `f15/p4-pestana-presets` lleva todo.
**Pendiente de la usuaria:** G7 (cierre) y la prueba a mano con interfaz, y la orden de subir las ramas. P5–P10 (onboarding y guías) esperan su plan just-in-time y su G4.


| P5 catálogo de guías y recomendación (`shared`) | `f15/p5-catalogo-guias` (sobre p4) | ver `git log` | G4 PASS (confirmado por la usuaria 2026-11-14), G5 PASS (V-027…V-030), G6 PASS (8 hallazgos: 3 corregidos, 5 declinados) |

**P5 construida (2026-11-14).** Ramas p1…p4 ya subidas a `origin`; p5 solo local. **Siguiente:** P6 (`configuration.onboarding`, cuentas nuevas en `pending` y tabla `user_guide_states`): primera migración de F15 y cambio del snapshot de puertas; necesita su plan, su G4 y la **aprobación expresa de la usuaria** para el snapshot.
