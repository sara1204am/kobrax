> ESTADO: CERRADO (2026-11-14) — G4 PASS confirmado por la usuaria; G5 y G6 PASS (`execution/VERIFICATIONS.md` V-027…V-031); commit local en `f15/p5-catalogo-guias`.

# Plan P5 · Catálogo de guías y recomendación inicial (`packages/shared`)

## 1. Objetivo
Crear en `packages/shared` la **única fuente** de lo que enseñan el asistente, el recorrido con spotlight, las guías de pantalla y el Centro de ayuda (el catálogo de guías), y la función pura `recommendSetup` que sugiere un preset según el plan. Es solo datos y funciones puras: sin base de datos, sin API, sin pantallas.

## 2. Rama
`f15/p5-catalogo-guias`, desde `f15/p4-pestana-presets` (la ola 1a aún no está en `dev`; si la usuaria mergea el PR antes, se parte de `dev`).

## 3. Estado inicial con evidencia (releído hoy, 2026-11-14)
| # | Hecho | Evidencia |
|---|---|---|
| E-1 | No existe ningún módulo de guías ni de recomendación en `shared`. | `packages/shared/src/utils/index.ts:1-43` (ningún `guides`/`onboarding`); H15-032 |
| E-2 | Las claves del menú ya están tipadas: `WorkspaceNavKey` (14 claves) y `WORKSPACE_MODULES` con `routes` y `core`. El catálogo de guías debe reutilizarlas, no repetirlas. | `utils/workspace.ts:33-47`, `:61-76` |
| E-3 | Los tres presets existen y se comparan con `presetOf`; `recommendSetup` devuelve una `WorkspacePresetKey`. | `utils/workspace.ts:381-411`, `:422` |
| E-4 | Los planes: `PlanCode` y `SIGNUP_PLANS = FREE, PROFESSIONAL, BUSINESS`; un plan desconocido o `STARTER` se normaliza con `planOf`. `ENTERPRISE` existe pero no es elegible al registrarse. | `constants/plans.ts:16`, `:143`, `:160-167` |
| E-5 | `resolveWorkspace(workspace, ctx)` reserva `ctx.planCode` y hoy no lo usa; la disponibilidad de un paso de guía es un cálculo `plan ∧ permiso ∧ workspace` en cada render, sin guardarse. | `utils/workspace.ts:315-317`; propuesta §4 |
| E-6 | El menú de la web tiene 14 ítems con su permiso (`NAV`); Seguridad es un grupo con `anyOf`. El catálogo no duplica permisos: cada paso apunta a la clave del menú y la web decide con `visibleNav`. | `apps/web/src/lib/nav.ts:64-84`, `:101-111` |
| E-7 | El script `test` de `shared` es `vitest run` (toma todo `*.spec.ts` de `src`); no hay lista que mantener. | `packages/shared/package.json` (`"test": "vitest run"`) |
| E-8 | Los textos van en `apps/web/src/messages/es.json` y `en.json` con prueba de paridad; `shared` no tiene i18n. | A-11 de la propuesta; `apps/web/src/messages/` |

## 4. Alcance / fuera de alcance
**Dentro**
- Módulo `utils/guides.ts` (o `guides/` si crece): tipos y catálogo **versionado** (`GUIDE_CATALOG_VERSION`) con tres familias de entrada:
  - **Recorrido general:** una entrada por ítem del menú (las 14 claves de `WorkspaceNavKey`) más los elementos de la barra superior (idioma, ayuda «?», avisos, menú de sesión, cambio de organización), en el orden en que se ven.
  - **Guías de pantalla (P10):** por módulo (Cartera, Mora, Agenda, Pagos, Rutas, Equipo, Organización), 2 a 4 pasos con su acción principal.
  - **Ayuda (P10):** una entrada por módulo y por acción, con las mismas claves.
- Cada entrada lleva: `id` estable, `module` (clave del menú), `target` (identificador de ancla, no un selector CSS), `order`, y los **requisitos** (`needsModule`, `needsOption` opcional) para filtrar contra el workspace. Los **textos no van aquí**: llevan una clave `guides.<id>.title|what|does|startWith` que la web resuelve en `messages` (ver Q-1).
- Función pura `guideSteps(ctx)`: dado `{ visibleNavKeys, granted modules/permisos ya resueltos por la web, … }`, devuelve los pasos del recorrido que corresponden a esa persona (módulo oculto o sin permiso se salta; D-18).
- Función pura `recommendSetup(ctx)` → `{ preset, reason }` con `reason` como clave de texto: Free → `independent`; Professional → `team`; Business → `complete`; sin datos o plan desconocido/`ENTERPRISE` → `independent` (D-12).
- Pruebas: `guides.spec.ts` y `recommend-setup.spec.ts`.
- Exportar desde `utils/index.ts`.

**Fuera**
- Textos es/en y su prueba de paridad (los escribe P7/P9/P10 con su pantalla; P5 solo fija las claves).
- Cualquier cambio de API, base, `schema.prisma`, JWT o `common/authz/*`.
- El estado de guías por persona (`user_guide_states`, P6) y todo el código de pantalla (P7–P10).
- Móvil (D-16). Sugerencias de descubrimiento (D-15, diferidas).

## 5. Dependencias
- Decisiones aprobadas: D-10, D-11, D-12, D-13, D-14, D-15, D-16, D-17, D-18 (`PROPUESTA` §6). Ninguna en PROPUESTA.
- Fases: ola 1a (P1–P4) construida (necesita `WORKSPACE_MODULES`, `WorkspaceNavKey`, `WORKSPACE_PRESETS`).
- Gates: G4 propio de P5 antes de tocar código (RULES F15-B).

## 6. Archivos afectados (con IDs HUB)
| Archivo | HUB | Cambio |
|---|---|---|
| `packages/shared/src/utils/guides.ts` (nuevo) | H15-032 | Catálogo y `guideSteps` |
| `packages/shared/src/utils/recommend-setup.ts` (nuevo) | H15-032 | `recommendSetup` |
| `packages/shared/src/utils/guides.spec.ts`, `recommend-setup.spec.ts` (nuevos) | H15-032 | Pruebas |
| `packages/shared/src/utils/index.ts` | — | Dos `export *` aditivos |
| `packages/shared/src/utils/workspace.ts` | H15-004 | **Solo lectura** (se importa; no se modifica) |

Ningún archivo de `apps/*` cambia. H15-032 pasa de `VERIFICADO (ausente)` a `MODIFICADO P5` al cerrar.

## 7. Invariantes que aplican
R1 (solo quita: el catálogo nunca agrega algo que el permiso o el plan no daba), R2 (la API no consulta nada de esto), R5 (ausente = Completo), D-5/D-8 (los troncales siempre aparecen en el recorrido si hay permiso), D-12, D-15, D-16, D-18; F15-B: cambios en `shared` aditivos y cruce D1 con `tsc` del móvil; RULES C (gratuito individual).

## 8. Perfiles de tenant afectados
P5 no cambia ningún comportamiento visible: son datos y funciones que nadie llama todavía. **Gratuito individual:** sin cambio alguno (C2); la recomendación para Free es `independent`, pero solo como sugerencia que en P7 verá un administrador de cuenta nueva. Regresión R-1: no aplica a P5 por no tocar pantallas ni API (`NOT_APPLICABLE` justificado en el G5); se corre completa en P7, que es la primera fase con efecto visible.

## 9. Riesgos
1. **Duplicar el menú:** si el catálogo copia las 14 claves a mano, se desfasa del `NAV`. Mitigación: tipado con `WorkspaceNavKey` y una prueba que exige una entrada de recorrido por cada clave de `WORKSPACE_MODULES`.
2. **Anclas frágiles:** un `target` que no existe en la pantalla rompe el spotlight en P9. Mitigación: los targets son identificadores simples (`nav.portfolio`, `topbar.help`…) y P9 los verifica con prueba; en P5 solo se prueba que sean únicos y con formato válido.
3. **Cruce con el móvil:** `shared` lo importa el móvil. Mitigación: cambio puramente aditivo y `tsc` del móvil.
4. **Recomendar por plan una promesa falsa:** Free no puede usar Equipo. Mitigación: la recomendación para Free es siempre `independent` (prueba de tabla) y `ENTERPRISE`/desconocido cae a `independent`.

## 10. Pruebas
- Existentes: `workspace.spec.ts` (28), `plans.spec.ts` y el resto de `shared` (542 al cierre de P4): deben seguir verdes.
- Nuevas (vitest, se recogen solas por `vitest run`; no hay lista de la API que registrar, RULES B12 no aplica a `shared`):
  - `recommend-setup.spec.ts`: tabla Free/Professional/Business/Enterprise/`STARTER`/desconocido/`undefined`; el preset devuelto existe en `WORKSPACE_PRESETS`; Free nunca devuelve `team` ni `complete`.
  - `guides.spec.ts`: una entrada de recorrido por cada clave del menú; ids y targets únicos; orden estable; `guideSteps` salta módulo oculto y sin permiso; troncales presentes; con workspace «Independiente» salen ~12 pasos y con «Completo» ~18 (cifras de D-18, (orientación, Q-2; la prueba exige un paso por cada módulo visible y elemento de la barra)); sin duplicados; claves de texto con formato `guides.<id>.*`.
- Verificación cruzada: `tsc --noEmit` en `shared`, `api`, `web`, `mobile`; `vitest run` en `shared` y `web` (regresión).

## 11. Rollback
Sin migración ni datos. Se deshace descartando la rama o revirtiendo el commit; ningún otro código depende todavía de estos módulos.

## 12. Tareas ordenadas (datos → API → web → móvil)
1. Datos/shared: tipos del catálogo y `GUIDE_CATALOG_VERSION`.
2. Entradas del recorrido general (menú + barra superior) y `guideSteps`.
3. Entradas de guías de pantalla y de ayuda por módulo (solo estructura y claves de texto).
4. `recommendSetup` con su tabla.
5. Exportar desde `utils/index.ts`.
6. Pruebas nuevas; correr `vitest` de `shared` y `web`.
7. `tsc` en los cuatro paquetes (cruce D1 con el móvil).
8. API, web y móvil: sin tareas.

## 13. Criterios de cierre
- **G5:** salidas pegadas en `execution/VERIFICATIONS.md`: `vitest` de `shared` (antes 542, sube), web sin regresión, `tsc` limpio en los cuatro; R-1 `NOT_APPLICABLE` justificado.
- **G6:** `/code-review` (medio) del diff y recorrido de `IMPACT-MAP` por H15-032 y H15-004.
- **G7:** actualizar HUB (H15-032), `STATUS`, `HANDOFF`, `PROGRESS` y los docs de producto; sin abrir P6.

## Decisiones de la usuaria (2026-11-14)
- **Q-1 APROBADA:** los textos de las guías viven **solo** en `apps/web/src/messages` (es/en, con la prueba de paridad existente); `shared` lleva únicamente claves. El móvil decide lo suyo en su etapa aparte (D-16).
- **Q-2 APROBADA:** las cifras del recorrido (~12 «Independiente», ~18 «Completo») son **orientación**. El criterio de aceptación es «un paso por cada módulo visible y por cada elemento de la barra superior».
