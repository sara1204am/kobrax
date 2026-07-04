# Epics de Kobrax

Cada fase del [Plan de Fases](../PLAN_DE_FASES.md) se ejecuta como un **epic** con
alcance cerrado. Esta carpeta es la fuente de verdad operativa de cada fase.

> **Principio fintech:** eficientes, seguros y detallistas. Ningún epic se marca
> "Completado" sin que su **checklist de seguridad** y su **DoD** estén verificados
> con evidencia (comandos, tests, capturas de salida).

## Índice

| Epic | Fase | Estado | Requisitos |
|------|------|--------|-----------|
| [EPIC-F0](./EPIC-F0-fundacion.md) | Fundación (monorepo + Pilar 1+2) | ✅ Completado | RF-01/02/03/04/05 (modelo) |
| [EPIC-F1](./EPIC-F1-nucleo-datos-infra.md) | Núcleo de datos + Infra | ✅ Completado | RF-01, RNF-02/04 |
| [EPIC-F2a](./EPIC-F2a-nucleo-auth.md) | Núcleo Auth + Multi-tenant + Bootstrap API | ✅ Completado | CU-01, RF-01/03, RNF-01/04 |
| [EPIC-F2b](./EPIC-F2b-gestion-cuenta.md) | Gestión de cuenta, MFA avanzado, offline | ✅ Completado | CU-01, RNF-01/05 |
| [EPIC-F4](./EPIC-F4-core-financiero.md) | **Core Financiero (clientes/créditos)** — adelantado · fases en [`F4/`](./F4/) | 📋 Listo para iniciar | RF-04/05, CU-02 |
| EPIC-F3 | Identidad y Organización + **administración RBAC** | ⏳ Diferido a fin de proyecto | RF-01/02/03 |
| [EPIC-F5](./EPIC-F5-casos-cobranza.md) | Casos de cobranza (v2 enterprise) | 🚧 Base de Fase 1 (subset) implementada | RF-06, CU-03 |
| [EPIC-F6](./EPIC-F6-rutas-campo-evidencia.md) | Rutas + campo + evidencia | ✅ Base completada | RF-07/08, CU-04 |
| [EPIC-F7](./EPIC-F7-pagos.md) | Pagos | ✅ Base completada | RF-09, CU-05 |
| [EPIC-F8](./EPIC-F8-realtime-notificaciones.md) | Realtime + notificaciones | ✅ Base completada | — |
| [EPIC-F9](./EPIC-F9-panel-web.md) | Panel Web | 📋 Listo para iniciar | RF-10, RNF-05 |
| [EPIC-F10](./EPIC-F10-app-mobile.md) | App Mobile | 📋 Listo para iniciar | CU-04, RNF-05 |
| EPIC-F11 | Analítica y reportes | ⏳ Pendiente | RF-10, RNF-04 |
| EPIC-F12 | Hardening y cumplimiento | ⏳ Pendiente | RNF-01/02/03/04 |

Estados: 📋 Listo para iniciar · 🚧 En curso · ✅ Completado · ⏳ Pendiente (esqueleto)

> **Re-secuenciación (2026-06-18):** por decisión de producto se **adelanta F4 (Core Financiero)** y se
> **difiere F3 (Identidad y Organización + administración de roles/permisos) al final del proyecto**. El
> *enforcement* RBAC ya está sembrado y operativo desde F2a, por lo que F4 no depende del módulo de administración
> de roles. La numeración canónica se conserva (F4 = Pilar 2 del doc de arquitectura).

## Diseño visual

El design system (tokens de color, tipografía, componentes, animaciones) vive en
**[../design-system.md](../design-system.md)** — fuente única, vinculante para web y mobile.
Los epics referencian ese doc; no duplican valores.

## Plantilla de epic

Todo epic sigue esta estructura (copiar de un epic existente):

1. **Cabecera** — ID, estado, owner (agente), dependencias, requisitos cubiertos.
2. **Objetivo de negocio** — el outcome, no la tarea.
3. **Alcance** — Incluye / No incluye (out of scope explícito).
4. **Historias y tareas** — tabla `# | historia | agente | entregable | estado`.
5. **Contratos y modelo de datos** — DTOs, endpoints, tablas/migraciones afectadas.
6. **Seguridad & Cumplimiento (checklist fintech)** — el corazón del epic.
7. **Criterios de aceptación (DoD)** — verificables, con evidencia.
8. **Estrategia de tests** — unit / integration / e2e y cobertura objetivo.
9. **Observabilidad & métricas** — logs, auditoría, métricas clave.
10. **Riesgos y mitigaciones**.

## Checklist de seguridad transversal (aplica a TODA fase)

Estos controles se revisan en cada epic; el epic añade los suyos específicos.

- [ ] Multi-tenant: toda query operativa corre con contexto RLS (`kobrax_app`, nunca superuser).
- [ ] Autorización: endpoint protegido por `JwtAuthGuard` + `RolesGuard` con permiso correcto.
- [ ] Validación: DTOs con `class-validator` (`whitelist` + `forbidNonWhitelisted`).
- [ ] Auditoría: toda mutación deja registro append-only en `audit_logs` (who/when/what/ip).
- [ ] Datos sensibles: cifrados/tokenizados, nunca en logs ni en respuestas.
- [ ] Errores: mensajes genéricos (sin filtrado de información ni enumeración de usuarios).
- [ ] Idempotencia: operaciones financieras protegidas contra doble ejecución.
- [ ] Secretos: desde env validado al boot; fail-fast si faltan; nunca hardcodeados.
- [ ] Rate limiting considerado en endpoints sensibles.
