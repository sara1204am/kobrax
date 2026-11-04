# F13 · Verificaciones

> Plantilla T5. **Sin salida pegada, la fila no cuenta.** Todas las verificaciones de G0 son de solo lectura sobre la documentación; no se ejecutó código de producto.
> Script usado: `check_harness.py` (en el directorio temporal de la sesión; no forma parte del repo).

| ID | Fecha | Fase | Qué se verificó | Comando | Resultado | PASS/FAIL |
|---|---|---|---|---|---|---|
| V-001 | 2026-10-29 | Arnés | Todo enlace relativo de los documentos nuevos resuelve | `python -I check_harness.py` | 1.ª corrida: `files: 48 links checked: 87 broken: 1` (`execution/README.md → ./VERIFICATIONS.md`, aún no creado). Corregido creando este archivo. 2.ª corrida: ver V-001b | PASS tras corrección |
| V-001b | 2026-10-29 | Arnés | Reverificación de enlaces | idem | `files: 49 links checked: 87 broken: 0` | PASS |
| V-002 | 2026-10-29 | Arnés | `F13/README.md` ≤ 60 líneas (lectura inicial pequeña) | idem | `F13 README lines: 47 (<=60: True)` | PASS |
| V-003 | 2026-10-29 | Arnés | Sin instrucciones contradictorias entre STATUS / HANDOFF / GATES / RULES / DECISIONS / ADR | `python -I check_harness.py` (sección Consistencia) + lectura | `ADR-0001: header=APROBADA index_match=True` · ADR-0002/0003/0004: `PROPUESTA`, `index_match=True` · `STATUS dice Discovery sin autorizar: True` · `HANDOFF siguiente paso = ninguno: True` · `ROADMAP marcado hipotesis: True` | PASS |
| V-004 | 2026-10-29 | Arnés | Una sesión nueva puede responder el criterio de éxito leyendo solo README → STATUS → RULES → HANDOFF | ver tabla siguiente | Cada pregunta tiene su archivo y existe | PASS |

## V-004 · Criterio de éxito → dónde se responde
| Debe poder… | Archivo |
|---|---|
| Entender qué es F13 y su objetivo | `README.md` («Qué es F13»), `../EPIC-F13-…md` §2 |
| Identificar la fase vigente | `STATUS.md` («Fase vigente») |
| Leer las reglas aplicables | `RULES.md` |
| Recuperar decisiones aprobadas | `decisions/DECISIONS.md` |
| Encontrar evidencia del estado actual | `discovery/` (hoy `00-leads.md`; Discovery no iniciado) |
| Consultar dependencias | `hub/HUB.md`, `hub/IMPACT-MAP.md` |
| Saber qué puede y qué no modificar | `STATUS.md` («Autorizaciones vigentes») |
| Ejecutar un plan de fase | `plans/README.md` + skill `/epic-fase` |
| Verificar resultados | `hub/VERIFICATION-MAP.md`, este archivo |
| Actualizar documentación y entregar contexto | `GATES.md` G7, `HANDOFF.md`, `_framework/TEMPLATES.md` T6 |

## V-005 · El arnés no tocó código de producto
`git status --porcelain` (2026-10-29): rutas del arnés = `docs/epics/README.md` (modificado) y nuevos `.claude/skills/epic-fase/`, `docs/epics/EPIC-F13-…md`, `docs/epics/F13/`, `docs/epics/F14/`, `docs/epics/_framework/`. Los demás archivos modificados (`apps/…`, `packages/…`) **ya estaban modificados por otro trabajo** de la rama `feat/cuenta-refactor` y no son de F13. Resultado: PASS (cero archivos de producto de F13).

## Limitaciones de esta validación
- El skill `epic-fase` no se ha invocado nunca; solo se comprobó que sus rutas existen. Su primera ejecución real será `retomar`.
- No se probó con una sesión realmente nueva: V-004 es una verificación de cobertura documental, no una simulación.
- Las clases de evidencia del HUB y de `00-leads.md` se asignaron a partir de lo leído el 2026-10-29; no se releyó el código para esta validación.

---

# Verificaciones de construcción (2026-11-02 / 2026-11-03)

Formato T5. Todas las corridas son **del coordinador** (re-ejecutadas por él, no solo reportadas por un agente) salvo donde se indica. Base de PRUEBA `kobrax_f13` y `kobrax_it`; nunca la base de desarrollo `kobrax`. Línea base previa a F13 (commit `bfbfdf4`, medida por el agente de pruebas del Discovery).

| Fecha | Fase | Qué se verificó | Comando | Resultado | PASS/FAIL |
|---|---|---|---|---|---|
| 2026-11-02 | P1 | Migración `20261102000000_oficinas_arbol` aplicada sobre datos del seed (2 cuentas, 25 créditos, 107 pagos) | `prisma migrate deploy` en `kobrax_f13` | 5 oficinas (2 raíces + 3 agencias), 14 asignaciones espejo, 0 créditos sin oficina, 0 pagos huérfanos | PASS |
| 2026-11-02 | P1 | Backfill por capas con casos difíciles (créditos sin oficina) | sección 5 de la migración re-ejecutada tras anular `branch_id` | Con responsable → oficina del responsable; cuenta con 2 agencias sin responsable → 2 **excepciones** (no se adivina); cuenta con 1 agencia → esa agencia | PASS |
| 2026-11-02 | P1 | Reconstrucción desde cero (esquema vacío + migraciones + RLS + seed nuevo) | `DROP SCHEMA` en `kobrax_f13`, `migrate deploy`, `rls/*.sql`, `seed.ts` | "✅ Seed completo" | PASS |
| 2026-11-02 | P1 | Coherencia del árbol | `psql < prisma/verify/oficinas-arbol.sql` | `OK · oficinas-arbol verificada`; 0 créditos sin oficina; 0 pagos huérfanos | PASS |
| 2026-11-02 | P2 | Permisos y equivalencia del MANAGER | migración `20261102010000` + `verify/oficinas-permisos.sql` | MANAGER: `data:scope:subtree` y NO `all`; asignado a la raíz (3 de 3 en la base, incl. el usuario en 2 cuentas); `office:read` ← roles con `user:read`; `office:write` ← roles con `account:write` | PASS |
| 2026-11-02 | P2 | Alcance de supervisor sin cambio | `verify/alcance-supervisor-agencia.sql` | `OK · alcance-supervisor-agencia verificada` | PASS |
| 2026-11-02 | P2 | Utilidades del árbol (shared) | `pnpm --filter @kobrax/shared test` | 36 archivos, **465 pass** (línea base 451; +14 de `office-tree`, +2 de `officeLabel` después) | PASS |
| 2026-11-03 | P2 | API: type-check | `pnpm --filter @kobrax/api type-check` | exit 0 | PASS |
| 2026-11-03 | P2 | API: suite completa | `pnpm --filter @kobrax/api test` | `# tests 1816 · # pass 1816 · # fail 0` (línea base **1732**; +84 casos; incluye el spec huérfano `agenda-overdue.spec.ts` ya registrado) | PASS |
| 2026-11-03 | P2 | Integración (oficinas, alcance, importación y los previos) | `REDIS_URL=redis://localhost:6379/7 pnpm --filter @kobrax/api test:integration` | `# tests 158 · # pass 158 · # fail 0`. Incluye R-1 (individual), R-3 (Chuquisaca), R-5/A-6 (oficina de otra cuenta), R-6 (pagos históricos), R-8 (equivalencia con la regla vieja), B-S7 (analítica con alcance) | PASS |
| 2026-11-03 | P3 | Web: type-check | `pnpm --filter @kobrax/web type-check` | exit 0 | PASS |
| 2026-11-03 | P3 | Web: suite completa | `pnpm --filter @kobrax/web test` | `7 failed · 1217 passed (1224)`; fallan **exactamente** los 7 preexistentes (`mora/arrears-table.test.tsx` ×6, `rutas/today-board.test.tsx` ×1), los mismos de la línea base | PASS (sin regresión) |
| 2026-11-03 | P3 | Web contra la API real (agente, curl al BFF; **no** navegador) | API de la rama en :4210 + web :3210 sobre `kobrax_f13` | Árbol renderiza; crear/mover/desactivar/restaurar/asignar/tipos OK; `BRANCH_MOVE_CYCLE` (422), `BRANCH_HAS_CHILDREN` (409), `PLAN_LIMIT_REACHED`; mover cartera `moved: 17` | PASS (verificado por el agente) |
| 2026-11-03 | P4 | Móvil: pruebas | `pnpm --filter @kobrax/mobile test` | 82 suites, **977 pass** (= línea base) | PASS |
| 2026-11-03 | P4 | Móvil: type-check | `pnpm --filter @kobrax/mobile type-check` | exactamente **2** errores en `app/cuenta/datos.tsx` (`AccountForm` sin `logoUrl`, `phone`, `email`, `website`…): **los mismos preexistentes** (D-8), ninguno nuevo | PASS (sin regresión) |
| 2026-11-03 | P4 | Selector de oficinas de la importación | `office-tree.spec.ts` (+2) y suite API | `officeLabel`: «Chuquisaca › Central» ≠ «Central»; cuenta plana conserva «Agencia Norte» | PASS |

## Lo que NO está verificado (a la fecha)
- **Navegador real:** el árbol, el arrastrar-y-soltar, la vista previa y los diálogos solo están cubiertos por tests de componentes (jsdom) y por peticiones al BFF; nadie los ha visto en pantalla.
- **Prueba de carga** con muchos nodos / carteras grandes: sin hacer (fase G).
- **Hidratación móvil con más de 150 fichas** bajo un alcance regional: sin cambios y sin medir en dispositivo (riesgo B-M2 sigue abierto).
- **Permisos de rol con `office:read` ausente** (supervisor, cobrador): cubiertos por tests, no por un recorrido real.
- **Datos reales de producción:** la migración se probó sobre el seed y sobre casos construidos; no sobre una copia de producción. **Antes de desplegar, correrla sobre una copia** y revisar `verify/oficinas-arbol.sql` (créditos sin oficina, pagos huérfanos).

## Verificación final tras la revisión independiente (2026-11-03, rama `f13/multi-oficina`)
| Qué | Comando | Resultado |
|---|---|---|
| API type-check / database / shared | `pnpm --filter @kobrax/{api,database,shared} type-check` | OK / OK / OK |
| API suite | `pnpm --filter @kobrax/api test` | `# tests 1821 · # pass 1821 · # fail 0` (base 1732) |
| Integración | `REDIS_URL=redis://localhost:6379/7 pnpm --filter @kobrax/api test:integration` | `# tests 162 · # pass 162 · # fail 0` |
| `import-assignment.it` caso 11 (antes intermitente) | 3 corridas aisladas desde `apps/api` | 11/11 · 11/11 · 11/11 tras filtrar `externalId` no nulo |
| shared | `pnpm --filter @kobrax/shared test` | 36 archivos · **467 pass** (base 451) |
| web | `pnpm --filter @kobrax/web test` / type-check | 7 fallan (**los 7 preexistentes**) · 1221 pasan · type-check OK |
| móvil | `pnpm --filter @kobrax/mobile test` / type-check | 82 suites · **977 pass** (= base) · 2 errores TS = los 2 preexistentes |
| SQL | `verify/oficinas-arbol.sql`, `oficinas-permisos.sql`, `alcance-supervisor-agencia.sql` | OK · OK · OK; informe de usuarios sin asignación en cuentas multi-oficina: 0 filas |

## P5 · decisiones de la usuaria (2026-11-03, rama `f13/p5-decisiones`)
- API unitarias 1847/1847 · integración 172/172 (`REDIS_URL=redis://localhost:6379/7`; si el limitador agota Redis: `docker exec kobrax-redis redis-cli -n 7 flushdb`) · `tsc` api y web limpios · shared build.
- Web: sólo los 7 fallos preexistentes (arrears-table ×6, today-board ×1); `team.test.ts` actualizado (MANAGER ya es asignable).
- SQL: `oficinas-arbol`, `oficinas-permisos` (con `office:read` del supervisor) y `alcance-supervisor-agencia` OK sobre `kobrax_it`.
- Integración nueva con datos reales (`office-scope.it.ts`): Cartera/Clientes/Pagos/Exportes acotados, ficha 404, backup 403, supervisor lee sólo su oficina, MANAGER invitado con y sin oficina.

## P6 · pantallas y cableado (2026-11-04, rama `f13/p6-oficina-ubicacion`)
- API unitarias 1849/1849 · web 120 archivos / 1239 pruebas sin fallos · shared 467 · `tsc` api y web limpios.
- SQL: `verify/oficinas-permisos.sql` ampliado (MANAGER con asignación a *alguna* oficina, COLLECTOR con `report:read` y sin alcance mayor, CHECK de ubicación) y OK sobre `kobrax`.
- Por la API (cuenta DEMO, `kobrax`): el cobrador de Padilla ve 1 crédito (el suyo) y 404 al abrir uno de Mesa Verde o de Cercado; su tablero (`/analytics/*`) trae sólo su crédito; el gerente de Chuquisaca ve 7 créditos y la ficha de su oficina trae la cartera (7 créditos, Bs 16.300,00) y a 5 personas del subárbol.
- Cableado revisado: rutas BFF de todo lo que llama la UI de oficinas (se encontró y se creó la que faltaba, `GET /api/roles`), claves de i18n sin uso borradas, `officeCandidates` (código muerto) borrada, matcher del middleware.
- **No verificado:** la UI en un navegador real (sigue sin verse por quien la construyó).
