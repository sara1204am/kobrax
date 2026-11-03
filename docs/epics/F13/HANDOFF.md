# F13 · HANDOFF

> Lo primero que lee la siguiente sesión después de README, STATUS y RULES. Se **reescribe** al cerrar cada sesión
> (los bloques viejos pasan a `PROGRESS.md` si importan). Plantilla: `../_framework/TEMPLATES.md` T6.

## Sesión 2026-10-29

- **Dónde quedó:** arnés (G0) creado y validado. Discovery no iniciado.
- **Terminado:**
  - Inspección del sistema de épicas existente y reutilización documentada.
  - Estructura `_framework/` + `F13/` + stub `F14/README.md`; skill `epic-fase`; filas F13/F14 en `docs/epics/README.md`.
  - `HUB.md` sembrado con puntos de integración vistos al analizar (estado `SEMBRADO`: no se releyeron).
  - `discovery/00-leads.md` con pistas del análisis previo, cada una con su clase de evidencia.
- **Falta:** todo Discovery (`discovery/01…09`), todo `target/`, ADR 0002–0004 sin decidir, `ROADMAP.md` solo hipótesis.
- **Decisiones aprobadas:** ADR-0001 (F13 absorbe F3, mantiene el número F13).
- **Decisiones pendientes:** ADR-0002 frontera F13/F14 · ADR-0003 árbol: extender `branches` o tabla nueva · ADR-0004 tenant gratuito/individual y el árbol. También sigue abierto si un usuario puede estar en más de una agencia, y cuántos niveles máximo (preguntas a la usuaria, aún sin respuesta).
- **Archivos cambiados:** solo documentación nueva en `docs/epics/_framework/`, `docs/epics/F13/`, `docs/epics/F14/`, `.claude/skills/epic-fase/`, y `docs/epics/README.md` (filas). Ningún archivo de producto. Lista exacta en `execution/PHASES-LOG.md`.
- **Verificaciones:** V-001…V-004 PASS (ver `execution/VERIFICATIONS.md`). No se corrieron `type-check` ni tests: no hubo código tocado.
- **Estado de git:** todo sin confirmar, en la rama `feat/cuenta-refactor`, que además trae cambios ajenos de cuenta/facturación. Antes de confirmar el arnés, decidir rama (sugerida: `f13/00-arnes` desde `main`) para no mezclarlo.
- **Siguiente paso autorizado:** **ninguno.** Esperar que la usuaria revise el arnés y autorice Discovery (G1). Si lo autoriza: `/epic-fase F13 retomar`, y empezar por `discovery/00-inventario.md`.

## Antes de continuar, cualquier sesión debe
1. Releer `STATUS.md` y confirmar que el «siguiente paso autorizado» sigue vigente.
2. Verificar con `git status` que no hay cambios de producto de F13 (no debería haberlos).
3. Recordar que el **móvil tiene una alineación con la web en curso**; no pisarla (`RULES.md` §D).
