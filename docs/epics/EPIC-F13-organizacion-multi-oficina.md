# EPIC-F13 · Organización multi-oficina

> **Arnés y control operativo:** [`F13/README.md`](./F13/README.md). Este archivo sigue la plantilla de epic de [`README.md`](./README.md);
> las secciones que dependen de Discovery/Arquitectura están marcadas **PENDIENTE** a propósito (no se rellenan con supuestos).

## 1. Cabecera
| Campo | Valor |
|---|---|
| ID | EPIC-F13 |
| Estado | 🚧 Arnés creado (G0 PASS). Discovery sin autorizar. Ver [`F13/STATUS.md`](./F13/STATUS.md) |
| Owner | Arquitecto General del Sistema (agente) con la usuaria como aprobadora de gates |
| Dependencias | F4–F10 construidos; coordinación con la alineación móvil↔web en curso ([`F10/plans/alineacion-web/`](./F10/plans/alineacion-web/README.md)) |
| Absorbe | F3 — «Identidad y Organización» ([ADR-0001](./F13/decisions/ADR-0001-f13-absorbe-f3.md)). La administración de roles va a [F14](./F14/README.md) |
| Requisitos | Por trazar en G1 (RF-01/02/03 del F3 original son el punto de partida, INFERIDO) |

## 2. Objetivo de negocio
Que Kobrax atienda a una organización con varios niveles de oficina (tenant grande, p. ej. banca) **sin dejar de servir** al cobrador independiente y a la agencia pequeña. Dos exigencias de la usuaria (2026-10-29): escalar hacia el tenant más grande, y que el tenant gratuito individual siga trabajando sin cambios ni configuración nueva.

## 3. Alcance
**Incluye (provisional, se cierra en G2):** modelo organizacional de oficinas; cómo se determina qué ve cada persona según su oficina; flujo de datos y analítica para niveles gerenciales; cómo entra un usuario por oficina; adaptación de los módulos web existentes; consideración del móvil; ingesta desde sistemas externos como punto de extensión.
**No incluye (provisional):** el catálogo fino de roles y permisos y su administración (→ F14); reemplazar el core bancario; construir infraestructura de big data (solo dejar el punto de enchufe, si la arquitectura lo justifica).

## 4. Historias y tareas
**PENDIENTE (G3).** El roadmap global vive en [`F13/ROADMAP.md`](./F13/ROADMAP.md) como hipótesis; los planes por fase se crean al empezar cada una.

## 5. Contratos y modelo de datos
**PENDIENTE (G2).** Lo que existe hoy está en discovery ([`F13/discovery/`](./F13/discovery/README.md)); lo objetivo, en [`F13/target/`](./F13/target/README.md).

## 6. Seguridad y cumplimiento (checklist fintech)
Aplica el checklist transversal de [`README.md`](./README.md) más los guardrails propios de [`F13/RULES.md`](./F13/RULES.md). Puntos propios que ya se sabe que hay que cubrir (se detallan en G2): aislamiento entre tenants intacto; alcance por oficina aplicado en servidor; auditoría de cada cambio de oficina o de alcance; sin elevación de privilegio por crear nodos o usuarios.

## 7. Criterios de aceptación (DoD)
- Gates G0–G7 en PASS con evidencia ([`F13/GATES.md`](./F13/GATES.md)).
- Regresión del perfil gratuito individual en PASS en cada fase ([`F13/RULES.md`](./F13/RULES.md) §C).
- Detalle por fase: **PENDIENTE (G3)**.

## 8. Estrategia de tests
**PENDIENTE (G2/G3).** Restricciones ya conocidas: los specs de la API se registran a mano en el script `test` (RULES B12); mapa de verificación en [`F13/hub/VERIFICATION-MAP.md`](./F13/hub/VERIFICATION-MAP.md).

## 9. Observabilidad y métricas
**PENDIENTE (G2).**

## 10. Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Romper a quien hoy usa una sola oficina | Perfil de tenant como criterio de cada fase (RULES §C); HUB antes de cambiar |
| El alcance por agencia vive en código de aplicación, no en la base | Registrado como guardrail B14; Discovery lo inventaría completo |
| Contradicciones entre docs y código sobre sucursales | Se registran en `discovery/00-leads.md` y se resuelven en G1 |
| Pisar la alineación móvil↔web en curso | RULES D1 |
| Mezclar el arnés con cambios ajenos del árbol de trabajo | RULES D2 |
