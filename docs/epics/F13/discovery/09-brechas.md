# Discovery · 09 · Brechas, riesgos y base del plan de implementación

> **Estado: COMPLETO 2026-11-02 (G1 pendiente de confirmación de la usuaria).** Consolida `00…08` y `10-referencia-gallium`.
> **Honestidad de evidencia:** "V-yo" = lo releí yo contra el código el 2026-11-02. "Agente" = lo reportó un agente de Discovery con `archivo:línea`; es VERIFICADO por él, pero **no recontrastado** por mí: se revalida al releer el archivo en el plan de la fase (RULES A7, T4 §3).
> No hay código de producto modificado. Requisitos: `../decisions/DECISIONS.md` (R1–R4, R7, R10, R11, R12, A-1…A-10).

## 1 · Contraste con el código (lo que comprobé yo)

| # | Afirmación | Resultado | Evidencia |
|---|---|---|---|
| V1 | `SUPER_ADMIN` no es un rol de plataforma operativo | **Confirmado** | solo enum `role.enum.ts:7`, permisos `permissions.ts:16` (todos), MFA `mfa-policy.ts:13`, seed `seed.ts:115`; el scope `global` (`permission.enum.ts:3`) no lo usa ningún guard; `auth/CLAUDE.md:44,54` lo describe y el código no lo implementa |
| V2 | RLS no lee alcance | **Confirmado** | `app_current_scope()`/`app_scope_sees_all()` solo aparecen en su definición (`rls/002_scope.sql:38-50`); ninguna policy las llama |
| V3 | Alcance BRANCH = igualdad con una `branch_id` y `LIMIT 1`; supervisor sin agencia ve solo lo suyo | **Confirmado** | `mora-query.ts:127-143` |
| V4 | `branch_id` nulable y sin FK en pagos | **Confirmado** | `schema.prisma:291` (UserAccount), `:808` (Credit), `:1331` (ruta), `:1528` (Payment: sin `@relation`) |
| V5 | Quien se registra solo es `ACCOUNT_ADMIN` dueño, sin oficina | **Confirmado** | `accounts.service.ts:75,114` |
| V6 | La analítica solo filtra `branchId` si se lo pasan | **Confirmado** | `analytics.service.ts:126,144,186,204,451` |
| V7 | Cartera pasa lista vacía de oficinas | **Confirmado** | `cartera/page.tsx:82` `branches={[]}` |
| V8 | Hidratación móvil con techo de 150 fichas | **Confirmado el techo** | `hydrate.ts:37` `MAX_FICHAS = 150` (qué pasa al superarlo: ver §8) |
| V9 | Spec huérfano (B12) | **Confirmado** | `agenda-overdue.spec.ts` existe y no está en `apps/api/package.json` (0 coincidencias) |
| V10 | `branchId`/`branch_id` en la API | **Corrige a un agente**: no son ~8 sitios sino **92 ocurrencias en 29 archivos** de producto (sin specs) | grep 2026-11-02 |

Línea base de regresión (agente, `bfbfdf4`; el agente corrió los comandos): API 1732 PASS · shared 451 PASS · móvil 977 PASS · web **7 fallos preexistentes** (`mora/arrears-table.test.tsx` ×6, `rutas/today-board.test.tsx` ×1) · type-check móvil FAIL (2 errores en `app/cuenta/datos.tsx`, deriva con `shared`) · type-check web FAIL solo por `.next/types` obsoletos · lint = placeholder · sin CI de tests. **La regresión se compara contra esta lista, no contra cero.** Causa de los 7 fallos web: INFERIDA (commit `a13d88c`), no confirmada.

## 2 · Matriz de requisitos y cumplimiento

| Req | Qué pide | Hoy | Cumple | Brechas |
|---|---|---|---|---|
| R1 | Niveles flexibles | `Branch` plano, sin padre/tipo (H-datos-01) | NO | B-D1, B-D2 |
| R2/R7 | Vista igual que Gallium | Solo Cuenta › Agencias, lista plana (H-web-01) | NO | B-W1…B-W4 |
| R3 | Usuario en varias oficinas | `@@unique([userId, accountId])`, un `branch_id` (H-datos-02) | NO | B-D3 |
| R4 | Alcance por subárbol (regional ve agencias) | igualdad con una `branch_id` (V3) | NO | B-A1, B-A2 |
| R10 | Caso Chuquisaca + ruta completa | seed plano (H-datos-12) | NO | B-D6, B-W2 |
| R11 | SUPER_ADMIN de plataforma | enum de tenant con todos los permisos (V1) | NO | B-S1 |
| R12 | `ACCOUNT_ADMIN` administra oficinas con `office:*`; tope por plan | `account:write` (H-05-06); sin tope (H-08-03) | NO | B-S2, B-S3 |
| A-1 | Todo crédito con oficina válida | nulable, escribe el cliente (H-datos-04, H-02-03) | NO | B-D4, B-M1 |
| A-2/A-7 | Pago con oficina histórica | `payments.branch_id` copia sin FK (V4, H-02-04) | PARCIAL | B-D5 |
| A-3 | Separar rol, permisos y alcance | rol global en `user_accounts` (H-datos-03) | NO | B-D3, B-S4 |
| A-4 | Admin sin oficina = total; supervisor sin oficina ≠ total | admin sí; supervisor ve solo lo suyo (V3, V5) | SÍ (hoy) | proteger con prueba R-1 |
| A-5 | JWT sin tocar | la oficina no viaja (H-05-02) | SÍ | — |
| A-6 | Servidor valida la oficina | `credits.branch_id` sale del DTO (H-02-03) | NO | B-D4 |
| A-8 | Ausencia de oficina ≠ sin restricción | crédito sin oficina invisible al supervisor (V3) | PARCIAL | B-D4 |
| A-9/A-10 | No romper individuales; migración progresiva | sin prueba e2e del individual (H-07-10) | NO verificable | B-T1 |

## 3 · Brechas (ubicación · impacto · prioridad · dependencia · tratamiento)

Prioridad: P0 = bloquea o puede causar fuga/pérdida de datos · P1 = necesaria para el objetivo · P2 = mejora/limpieza. Tratamiento: **R**eutilizar · **A**daptar · **C**onstruir.

### Datos e integridad
| ID | Brecha | Ubicación | Impacto | Pri | Depende de | Trat. |
|---|---|---|---|---|---|---|
| B-D1 | `Branch` sin padre, nivel ni tipo | `schema.prisma:134-155` | sin árbol | P0 | ADR-0003 | A (extender) o C (tabla) |
| B-D2 | No existe catálogo de tipos de nivel configurable (R1) | — | sin niveles flexibles | P0 | B-D1 | C |
| B-D3 | Un usuario = una oficina y un rol por cuenta | `schema.prisma:284-305` | sin R3/A-3 | P0 | B-D1 | C (tabla de asignación usuario+oficina+rol) |
| B-D4 | `credits.branch_id` nulable, sin índice, lo da el cliente | `credits.service.ts:288,463`, `portfolio-credit.ts:109` | créditos invisibles, oficina no validada | P0 | B-D1, decisión datos históricos | A |
| B-D5 | `payments.branch_id` sin FK; copia del crédito | `schema.prisma:1528`, `payments.service.ts` | histórico inconsistente | P1 | B-D1 | A (FK + semántica histórica) |
| B-D6 | Seed y `verify/seed-sin-caso.sql` exigen agencias planas | `prisma/seed*.ts`, `verify/seed-sin-caso.sql` (agente) | seed R10 rompería verify | P1 | B-D1 | A |
| B-D7 | Baja de oficina sin tratamiento de huérfanos | H-datos-11 (agente) | datos colgados | P1 | B-D1 | A |
| B-D8 | Sin `ltree`; Postgres 15 con solo `pg_stat_statements` | H-08-02 (agente) | consultas de subárbol deben ser CTE recursivas o ruta materializada | P1 | ADR-0003 | decidir |

### Seguridad y autorización
| ID | Brecha | Ubicación | Impacto | Pri | Depende de | Trat. |
|---|---|---|---|---|---|---|
| B-S1 | `SUPER_ADMIN` no es de plataforma | V1 | contradice R11; riesgo de bypass | P0 | plan de migración | C (capa de plataforma) |
| B-S2 | Oficinas gestionadas con `account:write` | `branches.controller.ts:16-43` (agente) | no hay `office:*` | P1 | B-D1 | C |
| B-S3 | Sin tope de oficinas por plan | `plans.ts:12` (agente, H-08-03) | R12 incumplido | P1 | B-S2 | C |
| B-S4 | Avisos/jobs buscan al admin por `role.name='ACCOUNT_ADMIN'` | H-05 / agente | se rompe con rol por asignación | P1 | B-D3 | A |
| B-S5 | `isMobileRole` impide asignar MANAGER/AUDITOR/VIEWER | `users.service.ts:146` (agente) | choca con rol por asignación | P1 | B-D3, F14 | A |
| B-S6 | RLS no impone oficina; la API es la única barrera | V2 | un olvido = fuga | P1 (diferido a fase de seguridad por A-5/R9) | — | C (fase posterior) |
| B-S7 | Analítica sin alcance del solicitante | V6 | fuga entre agencias hoy | **P0** | B-A1 | A |

### Backend / alcance
| ID | Brecha | Ubicación | Impacto | Pri | Depende de | Trat. |
|---|---|---|---|---|---|---|
| B-A1 | 4 implementaciones del alcance agencia | `mora-query.ts:127-152`, `prisma.service.ts:93`, `assignment.service.ts:159`, `agenda.service.ts:175` | divergencia | P0 | B-D1, B-D3 | C (servicio único `OfficeScope`) |
| B-A2 | Consumidores del alcance: 29 archivos / 92 ocurrencias | V10 | migración amplia | P0 | B-A1 | A (uno por uno, con prueba) |
| B-A3 | Definiciones BRANCH no idénticas (visibilidad exige responsable y `branch_id`; reparto no) | H-02-02 (agente) | cambio de comportamiento si se unifica sin cuidado | P0 | B-A1 | decidir equivalencia |
| B-A4 | Cartera, clientes, pagos, analítica sin alcance por fila | H-02-07 (agente) | R4 no aplica ahí | P1 | B-A1 | A (decidir si entran) |
| B-A5 | Trabajos `setInterval`/CLI recorren cartera sin alcance | H-02-12, H-06-10 (agente) | notificaciones fuera de alcance | P2 | B-A1 | revisar |
| B-A6 | Importación: oficina solo si la corrida es `branch`; `branchLabel` parseado y sin uso; `assertImportAgency` por igualdad | `portfolio-credit.ts:109`, H-06-02…04 (agente) | créditos importados sin oficina | P0 | B-D4 | A |
| B-A7 | `CreditDataOrigin.API` reservado, sin escritor | H-06-01 (agente) | integración externa futura | P2 | — | fuera de F13 (fase G) |

### Web / UX
| ID | Brecha | Ubicación | Pri | Trat. |
|---|---|---|---|---|
| B-W1 | No existe árbol recursivo, arrastrar-y-soltar, vista previa, detalle, papelera (H-gal-*, H-web-11) | — | P1 | C (reimplementar el comportamiento; stack distinto: Next 14/Tailwind vs Next 16/PrimeReact) |
| B-W2 | Ruta completa siempre visible (R10); Gallium solo en vista previa | — | P1 | C |
| B-W3 | Sin selector de oficina en el shell | `panel-shell.tsx` (agente) | P2 (con JWT/contexto) | C |
| B-W4 | Permiso de pestaña (`user:read`) ≠ botones (`account:write`) | H-web-02 (agente) | P1 | A (a `office:*`) |
| B-W5 | Cartera `branches={[]}`; Dashboard sin control; Equipo sin oficina | V7, H-web-05/07/08 | P1 | A |
| B-W6 | Comentarios desactualizados (`cartera/page.tsx:80`, `dashboard-filters.tsx:22`), terminología mezclada agencia/oficina/sucursal | H-web-13 (agente) | P2 | limpieza |
| B-W7 | `plans.ts:12` y `docs/producto/README.md` dicen "no hay sucursales" | L-11 | P2 | limpieza (código manda) |
| B-W8 | Gallium: no copiar valores fijos ni su desajuste árbol/datos (H-gal-04, H-gal-07) | — | P1 | diseño |

### Móvil
| ID | Brecha | Ubicación | Pri | Trat. |
|---|---|---|---|---|
| B-M1 | `Me` no trae oficina/alcance; ninguna pantalla envía `branchId` | H-mov-01 (agente) | P2 (JWT/contexto después, A-5) | diferido |
| B-M2 | Hidratación con techo 150; atada a pantallas | `hydrate.ts:37`, H-mov-03/04 | **P0 si el alcance regional supera 150** | ver §8 |
| B-M3 | Alineación F10 en curso; plan sin actualizar desde 2026-10-10 | H-mov-06 (agente) | P1 (RULES D1) | coordinar antes de tocar móvil |
| B-M4 | type-check móvil roto por deriva con `shared` (`app/cuenta/datos.tsx`) | H-07-07 (agente) | P1: no es de F13, pero **bloquea tener línea base verde** | registrar como preexistente |

### Pruebas y calidad
| ID | Brecha | Pri |
|---|---|---|
| B-T1 | No hay prueba e2e/integración del perfil gratuito individual ni de oficinas (9 `.it.ts` no tocan oficinas) | **P0** (RULES C4 deja G5 BLOQUEADO hasta definirla) |
| B-T2 | Spec huérfano `agenda-overdue.spec.ts` (V9) | P2 |
| B-T3 | 7 fallos web preexistentes | P1: arreglar o excluir de la comparación, decidir |
| B-T4 | Sin CI de tests/type-check/lint | P1 |
| B-T5 | `shared` sin specs de oficina/alcance (B10: lógica compartida web/móvil vive en `shared`) | P1 |

## 4 · Reutilizar · adaptar · construir

- **Reutilizar:** módulo `branches` (CRUD, auditoría, código único `20261021110000`), `BranchesManager` y `lib/branches.ts` (base de listado/alta/miembros), `Modal/Section/Badge/EmptyState`, `usePermissions`, BFF + `sendJson`, `DataTable` con filtros por URL, `audit.record`.
- **Adaptar:** `Branch` (padre/tipo) o tabla nueva, `user_accounts` → asignaciones, los 29 consumidores de `branchId`, importación, analítica, filtros de Cartera/Dashboard/Equipo, seeds y `verify`.
- **Construir:** servicio único de alcance, catálogo de tipos de nivel, tabla de asignaciones, permisos `office:*`, tope por plan, árbol interactivo, detalle, papelera, selector de oficina, capa de plataforma para `SUPER_ADMIN`, pruebas de integración/regresión.

## 5 · Mapa de dependencias (orden obligatorio)

```
Decisiones (ADR-0003 árbol · rol/alcance por asignación · datos históricos)
  → [P1 Datos] árbol + tipos + asignaciones + backfill créditos + FK pagos + seeds/verify
      → [P2 Alcance] servicio único (equivalente al actual en tenants sin árbol)
          → migrar consumidores uno a uno: mora → agenda → asignaciones → rutas/field-ops
            → analítica (cierra B-S7) → exportes/importación → notificaciones/jobs
          → [P2b Permisos] office:read/write · tope por plan · quitar account:write de oficinas
              → [P3 Web] árbol/detalle (Gallium) → filtros Cartera/Dashboard/Equipo
                  → [P4 Móvil] (tras alineación F10; hidratación §8)
[Plataforma] SUPER_ADMIN → capa de plataforma (plan de migración aparte; no bloquea P1–P2)
[Seguridad] JWT/contexto de oficina + RLS por alcance (después, A-5/R9)
```
Reglas: nada de P2 sin P1 cerrada; nada de web sin API; el móvil al final; `shared` se reconstruye al tocarlo (B13); todo spec nuevo se registra en el script `test` (B12).

## 6 · Riesgos

| Pri | Riesgo | Mitigación |
|---|---|---|
| P0 | Unificar el alcance cambia el comportamiento (B-A3: visibilidad y reparto difieren) | Pruebas de equivalencia **antes** de migrar cada consumidor; el servicio nuevo con modo idéntico al actual para tenants sin árbol |
| P0 | Backfill de `credits.branch_id` sin información suficiente | Estrategia por capas (ver §7); nunca inventar; informe de excluidos; sin `NOT NULL` hasta cerrar el backfill |
| P0 | Analítica sin alcance (B-S7) se hace evidente con el árbol | Aplicar alcance al migrar analítica; prueba de aislamiento entre oficinas |
| P0 | Sin prueba del individual (B-T1) | Definir y automatizar la lista de flujos en G2 (`target/09`) antes de la primera fase |
| P1 | Rol por asignación rompe avisos/jobs y `isMobileRole` (B-S4/S5) | Revisión previa de notificaciones, invitaciones y restricciones (A-3) en el plan de P1 |
| P1 | Móvil con alcance regional > 150 fichas (B-M2) | Ver §8 |
| P1 | 7 fallos web y type-check móvil rotos: se confunden con regresiones | Línea base congelada (§1) |
| P1 | Pagos históricos descuadran al mover créditos (A-2/A-7) | `payments.branch_id` inmutable y FK; reportes por oficina histórica vs actual como dos dimensiones |
| P2 | Un servidor sin réplica; carga de árboles grandes | Resúmenes por nodo (memoria `pitch-bancos-piloto`), fase G |
| P2 | Terminología mezclada; documentos desactualizados | Limpieza por fase |

## 7 · Migración de créditos, pagos e importaciones (riesgos)

- **Créditos históricos sin oficina (decisión pendiente, D-3):** orden propuesto, sin inventar datos: (1) oficina del responsable asignado si tiene exactamente una; (2) oficina de la importación/alcance si consta; (3) oficina única de la cuenta si solo hay una (tenant individual → oficina implícita); (4) el resto queda en lista de **excepciones** que revisa el `ACCOUNT_ADMIN`. `NOT NULL` y la validación A-1 se activan solo cuando las excepciones llegan a 0.
- **Pagos:** no se reescribe ningún `payments.branch_id` existente; solo se añade la FK (los huérfanos se tratan antes) y se documenta que es histórico (A-2).
- **Importaciones:** hoy el crédito importado con alcance cuenta/oficial queda sin oficina (`portfolio-credit.ts:109`); el servidor debe derivarla (A-6) y la re-importación no debe cambiarla en silencio (H-06). La columna "Agencia" del archivo se decide si se usa.
- **Reversibilidad:** migraciones solo aditivas (RULES §E); sin migrar de golpe; script `verify/*.sql` por fase (B8).

## 8 · Móvil: hidratación y sincronización con más de 150 registros

- Hecho (V-yo): existe `MAX_FICHAS = 150` en `hydrate.ts:37`, definido como "techo de fichas que se bajan de a una".
- **NO VERIFICADO por mí:** qué hace exactamente al superar el techo (corta, pagina o rechaza) y cuántos créditos baja el listado antes de ese paso. Pendiente de lectura de `hydrate.ts` completo y `data-layer.test.ts` (que pagina de a 100 con `meta.total`).
- Riesgo: un normalizador asignado a una regional (R4) puede superar ese techo; sin señal, sus fichas quedarían incompletas. Se resuelve en la fase móvil (P4) con el plan que lea esos archivos hoy; mientras tanto el móvil no cambia (A-5, RULES D1).
- La cola de sincronización es idempotente (id del teléfono); no depende de la oficina (H-06-08, agente).

## 9 · Pruebas de regresión a definir (`target/09`, antes de la primera fase)

| Código | Escenario | Qué prueba |
|---|---|---|
| R-1 | Tenant individual (`ACCOUNT_ADMIN`, sin oficinas) | alta de crédito, cobro, mora, agenda, ruta, pago, analítica: mismo resultado que hoy |
| R-2 | Agencia pequeña (2 sucursales, árbol de 1 nivel) | alcance idéntico al actual; supervisor sin oficina ve solo lo suyo (A-4) |
| R-3 | Organización multi-oficina (caso Chuquisaca R10) | regional ve las 6 agencias; supervisor de agencia ve la suya; normalizador de regional con créditos de varias agencias (R4) |
| R-4 | Supervisor / cobrador | lo propio + lo de su alcance; crédito sin responsable no visible con alcance agencia |
| R-5 | Aislamiento entre tenants | ningún acceso cruzado (SQL e integración, H-07-04) |
| R-6 | Pagos históricos | mover un crédito no cambia el `branch_id` de pagos previos |
| R-7 | Importación | oficina derivada por el servidor; re-importación estable |
| R-8 | Equivalencia | servicio único = comportamiento actual en tenants sin árbol, caso por caso (B-A3) |
Cada una con su salida pegada en `execution/VERIFICATIONS.md` (A5) y registrada en el script `test` (B12). Una vez definidas, G5 deja de estar BLOQUEADO (RULES C4).

## 10 · Fases de implementación propuestas (hipótesis para G3)

| Fase | Contenido | Sale con |
|---|---|---|
| P0 | Cerrar G1/G2: ADR-0003 y rol/alcance por asignación aprobados; lista de regresión; congelar línea base (arreglar o excluir los 7 fallos web; registrar el spec huérfano) | G2/G3 PASS |
| P1 Datos | árbol + tipos de nivel + asignaciones + índices + backfill con excepciones + FK de pagos + seed R10 y `verify` | verify SQL PASS; R-1/R-2 verdes |
| P2 Alcance y permisos | servicio único; migración de consumidores uno a uno; `office:*`; tope por plan; analítica con alcance | R-1…R-8 PASS |
| P3 Web | árbol y detalle como Gallium, ruta completa, filtros de Cartera/Dashboard/Equipo | pruebas web + R-1 |
| P4 Móvil | tras alineación F10; hidratación §8 | offline intacto |
| Plataforma | `SUPER_ADMIN` de plataforma (plan de migración aparte) | auditoría y MFA |
| Seguridad (posterior) | JWT/contexto + RLS por alcance | fuera de F13 base (A-5) |

## 11 · Decisiones que requieren aprobación

| ID | Decisión | Mi recomendación |
|---|---|---|
| D-1 | ADR-0003: extender `branches` o tabla nueva; representación del árbol (CTE recursiva vs ruta materializada, sin `ltree`) | Extender `branches` con padre + tipo (menos migración, reutiliza código y auditoría); ruta materializada si el rendimiento lo pide |
| D-2 | Rol por asignación (R8) | Sí |
| D-3 | Estrategia de backfill de créditos (§7) | Capas + excepciones, `NOT NULL` al final |
| D-4 | "Solo lo suyo" del supervisor sin oficina | Responsable o apoyo vigente, igual que hoy (V3) |
| D-5 | Reasignar créditos entre oficinas: quién y cómo | Con permiso explícito (`office:write` o `assignment:write`), auditado; pagos previos intactos |
| D-6 | Reportes con reasignación | Dos dimensiones: oficina histórica del pago / oficina actual del crédito |
| D-7 | ¿Cartera, clientes, pagos y analítica entran al alcance por oficina? | Analítica sí (cierra fuga); Cartera/Pagos según decisión de producto |
| D-8 | 7 fallos web y type-check móvil: ¿se arreglan antes, o se excluyen de la línea base? | Fuera de F13: registrar como preexistente y no mezclar |
| D-9 | Plan de migración de `SUPER_ADMIN` (sin bypass) | Fase propia, después de P2 |
| D-10 | Autorización de la usuaria para pasar G1 → G2 | — |

## 12 · Contradicciones y desconocidos

**Contradicciones (el código manda):** `plans.ts:12` y `docs/producto/README.md` dicen que no hay sucursales, pero el módulo existe (L-11) · `auth/CLAUDE.md` describe SUPER_ADMIN de plataforma que el código no implementa (V1) · cabecera del plan de alineación móvil vs su cuerpo (H-mov-06) · comentarios de `cartera/page.tsx:80` y `dashboard-filters.tsx:22` vs `GET /branches` existente.

**Desconocidos (quién los responde):** datos reales de cuentas, oficinas y créditos con `branch_id` NULL (consulta de solo lectura autorizada por la usuaria) · si existe algún usuario SUPER_ADMIN en una base real · `role_permissions` en base vs `ROLE_PERMISSIONS` · contenido de `rls/verify_isolation.sql` (no leído) · comportamiento de `hydrate.ts` por encima de 150 (§8) · causa de los 7 fallos web · si `packages/shared/dist` está al día · existencia de staging · tope comercial de sucursales (decisión de negocio) · uso de `Role.level` fuera de `apps/api/src` · notificaciones/exportes: ¿deben respetar subárbol? · aviso: el agente de 06 reportó que `06-sync-importacion.md` cambió en disco tras reescribirlo y no lo releyó; **pendiente releerlo**.
