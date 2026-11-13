# F13 · HANDOFF

> Lo primero que lee la siguiente sesión después de README, STATUS y RULES. Se **reescribe** al cerrar cada sesión
> (los bloques viejos pasan a `PROGRESS.md` si importan). Plantilla: `../_framework/TEMPLATES.md` T6.

## Sesión 2026-11-02 / 2026-11-03

- **Dónde quedó:** P1–P4 construidas y verificadas en ramas locales (sin push). Rama de integración `f13/multi-oficina` = `f13/p4-movil`. Código en el worktree `C:\Startup Kobrax\kobrax-f13-web` (el worktree `C:\Startup Kobrax\kobrax-f13` tiene `f13/p2-alcance`, ya integrada). La carpeta `C:\Startup Kobrax\kobrax` es de la usuaria (rama `feat/perfil-refactor`, servidores de desarrollo): no tocarla.
- **Terminado:** Discovery completo; arquitectura objetivo; P1 datos (árbol, tipos, asignaciones, backfill); P2 API (servicio único de alcance, oficinas, tope por plan, oficina decidida por el servidor, reasignación de cartera, analítica con alcance); P3 web (vista de oficinas como Gallium, selectores, alta de préstamo con oficina); P4 (rótulo de oficinas en la importación; el móvil no necesitó cambios). Revisión independiente (Fable) sin P0; P1 y P2 corregidos.
- **Evidencia:** `execution/VERIFICATIONS.md` (API 1821/1821, integración 162/162, shared 467/467, móvil 977/977, web = 7 fallos preexistentes, type-check igual que la línea base).
- **Falta / pendiente de la usuaria (ver STATUS «Bloqueos»):** probar la UI en un navegador real; prueba de carga; probar la migración sobre una **copia de producción**; asignación de MANAGER por API (F14); `office:read` para el supervisor; tope ENTERPRISE; D-7 (alcance de Cartera/Clientes/Pagos/Exportes); fase de plataforma (`SUPER_ADMIN`) y fase de seguridad (JWT/RLS por alcance); hidratación móvil > 150 fichas; push/PR/merge (nada se subió).
- **Decisiones adoptadas por la IA y revisables:** R13, D-5, AUDITOR/VIEWER con alcance total, ADR-0002 (ver `decisions/DECISIONS.md`, R15).
- **Archivos de producto cambiados:** `packages/database` (2 migraciones, schema, seed, verify), `packages/shared` (permisos, planes, `office-tree`), `apps/api` (office-scope, branches, credits, analytics, mora, agenda, assignments, imports, accounts, users, plan), `apps/web` (Cuenta › Oficinas, selectores, alta de préstamo, mensajes), docs de producto. Lista exacta: `git diff bfbfdf4...f13/multi-oficina --stat`.
- **Verificaciones no corridas:** UI en navegador real, carga, copia de producción.
- **Siguiente paso autorizado:** **ninguno hasta que la usuaria lo ordene.** Opciones que ella puede pedir: (a) probar en navegador y ajustar, (b) preparar el PR / merge de `f13/multi-oficina`, (c) F14 (roles: asignar MANAGER por API, delegación), (d) fase de seguridad (JWT/RLS), (e) fase de plataforma (`SUPER_ADMIN`).

## Sesión 2026-11-04 (P6)
- **Dónde quedó:** rama local `f13/p6-oficina-ubicacion` (sobre `integracion/f13-dev` = `origin/dev` + F13, sin push). La carpeta de la usuaria (`C:\Startup Kobrax\kobrax`) corre ESTA rama con su base `kobrax` ya migrada y sembrada; la copia aparte (3100/4110) se apagó.
- **Hecho:** ver STATUS «P6». Revisión de cableado hecha (ver VERIFICATIONS «P6»).
- **Lo primero que sigue, si lo ordena:** decidir el alcance de `GET /users` y de «añadir persona» (hoy un gerente regional ve a todo el personal de la cuenta) y los clientes sin crédito vivo.

## Antes de continuar, cualquier sesión debe
1. Releer `STATUS.md` y confirmar que el «siguiente paso autorizado» sigue vigente.
2. `git -C "C:/Startup Kobrax/kobrax-f13-web" status` y confirmar la rama; no mezclar con `feat/perfil-refactor`.
3. Usar SOLO las bases `kobrax_f13` / `kobrax_it`; `REDIS_URL=redis://localhost:6379/7` para las pruebas de integración.
