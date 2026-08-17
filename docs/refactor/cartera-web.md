# KOBRAX — DataTable genérico + Refactor de Cartera

> **Plan de ejecución para Claude Code.**
> Lee este documento completo antes de escribir una sola línea de código.
> La FASE 0 (auditoría) es obligatoria y bloqueante: no avances a ninguna otra fase sin haberla completado y reportado.

---

## Objetivo

Dos entregables en un solo esfuerzo, claramente separados:

1. **Capa A — DataTable genérico (plataforma):** un componente de tabla reutilizable, configurable y agnóstico del dominio, que será la base de TODAS las tablas del sistema en el futuro.
2. **Capa B — Cartera (primer consumidor):** refactorizar la pantalla `Cartera` (listado de personas/clientes) usando el DataTable genérico, con su lógica de dominio propia (agregación por persona, deuda, mora, estados).

Regla funcional principal de Cartera:

> **1 fila = 1 persona.** Una persona puede tener N créditos; la tabla muestra a la persona una sola vez con información agregada.

### Fuera de alcance (NO implementar en esta fase)

- Ficha detallada del cliente, garantías, detalle de créditos, dashboard de KPIs, agenda, cobranza, acciones de gestión.
- **Migrar otras tablas existentes al componente genérico.** El genérico se construye, se documenta y se estrena con Cartera. Las demás pantallas migran en fases futuras.
- Acciones masivas (la selección múltiple sí, las acciones no).
- Export CSV/Excel (pero la API debe quedar preparada, ver §B4).

---

# FASE 0 — AUDITORÍA (OBLIGATORIA Y BLOQUEANTE)

Antes de modificar código, inspecciona el repositorio completo y responde. **Entrega este reporte y DETENTE para revisión antes de continuar:**

```text
1.  Framework y versión (frontend y backend):
2.  Librería de componentes UI / design system:
3.  Sistema actual de tablas (¿componente propio? ¿librería? ¿HTML plano?):
4.  Sistema de estilos (CSS modules, Tailwind, styled, etc.):
5.  Arquitectura de frontend (routing, estado global, data fetching):
6.  Arquitectura de API (REST/GraphQL/tRPC, convenciones de endpoints):
7.  Endpoint actual de Cartera (ruta, params, respuesta):
8.  Query actual de clientes (¿trae créditos? ¿agrega en frontend?):
9.  Modelo de datos: personas, créditos, estados, deuda, mora
    (tablas/colecciones, relaciones, índices existentes):
10. Paginación actual (¿server-side? ¿offset? ¿todo al frontend?):
11. Filtros actuales (dónde se ejecutan):
12. Sorting actual (dónde se ejecuta):
13. Persistencia de preferencias existente (localStorage, backend, ninguna):
14. Patrones reutilizables ya existentes:
    - DataTable / filtros / pagination / query params / URL state
    - debounce / infinite scroll / skeleton / empty states
15. Otras tablas del sistema (listarlas): servirán para validar que el
    contrato del genérico les sirve, aunque NO se migren ahora.
16. Volumen real de datos actual (personas, créditos):
17. Problemas encontrados (performance, duplicación, deuda técnica):
```

**Reglas de la auditoría:**
- NO crees una nueva arquitectura si el proyecto ya tiene una solución consistente: reutiliza y evoluciona.
- NO introduzcas librerías nuevas sin justificarlo en el reporte.
- Si detectas una decisión arquitectónica de alto impacto (ej. la agregación requiere cambios de schema), explícala ANTES de implementarla.

---

# CAPA A — DATATABLE GENÉRICO

## A1. Principio de diseño

El componente **no debe saber nada de clientes, deuda ni mora**. Todo lo específico de Cartera entra por configuración. Test mental: el mismo componente debería poder renderizar una tabla de créditos, de cobradores o de sucursales solo cambiando la config y el adaptador de datos.

## A2. Contrato de configuración

Adapta nombres/sintaxis a las convenciones del proyecto, pero el contrato conceptual es:

```text
<DataTable
  tableId="cartera"            // clave única: persistencia + URL
  columns={[...]}              // ver A3
  dataAdapter={fn}             // ver A4
  defaultSort={...}
  defaultPageSize={50}
  pageSizeOptions={[25, 50, 100, 200]}
  selectable={true}
  urlSync={true}
  emptyState={...}             // textos/acciones personalizables
  noResultsState={...}
  errorState={...}
/>
```

## A3. Definición de columnas

Cada columna se define con:

```text
{
  key:              string      // identificador estable
  label:            string
  sortable:         boolean
  filterType:       'text' | 'numberRange' | 'select' | 'multiSelect' | 'dateRange' | null
  filterOptions?:   [...]       // para select/multiSelect
  render?:          fn(row)     // renderer de celda (badges, formatos)
  visibleByDefault: boolean
  align?:           'left' | 'right' | 'center'
  width?:           ...
}
```

- El registro de `filterType` debe ser **extensible**: agregar un tipo nuevo de filtro no debe requerir tocar el core de la tabla.
- Formatos regionales (Bs, miles con punto, fechas dd/mm/aaaa) viven en renderers/utilidades, **nunca hardcodeados en el core**.

## A4. Adaptador de datos

El genérico no llama APIs directamente. Recibe una función:

```text
dataAdapter({ search, filters, sort, order, page, pageSize })
  → Promise<{ data: [...], meta: { total, page, pageSize, totalPages } }>
```

Responsabilidades del core alrededor del adaptador:

- **Debounce** 300–500ms en filtros de texto (adaptar al patrón existente).
- **Cancelación / anti-race:** si el usuario escribe `edg` y luego `edgar`, la respuesta vieja NUNCA sobrescribe la nueva (AbortController o mecanismo equivalente del data-fetching del proyecto).
- **No duplicar requests** ante un mismo cambio de estado.
- **Refetch suave:** al cambiar un filtro no destruir la UI completa; mantener continuidad visual.

## A5. Funcionalidades del core

1. **Sorting** por columna: `sin ordenar → asc → desc` (server-side, vía adaptador).
2. **Filtros por columna** según `filterType`, combinables entre sí (AND).
3. **Zona de filtros globales** configurable (slot/prop), con botón `+ Más filtros`. No mostrar 15 filtros a la vez.
4. **Chips de filtros activos:** cada chip eliminable individualmente → actualizar estado → refetch. Botón `Limpiar todos`.
5. **Paginación server-side:** opciones 25/50/100/200, default 50, indicador `Mostrando 1–50 de 1.248`, controles `‹ 1 2 3 … N ›`.
6. **Búsqueda global** con debounce.
7. **Columnas configurables** (botón `⚙ Columnas`): mostrar/ocultar y reordenar. Drag & drop solo si el proyecto ya lo facilita; si no, botones arriba/abajo bastan.
8. **Selección múltiple:** checkbox por fila + selección de página. Al haber selección, toolbar contextual `N seleccionados [Acciones]` (acciones vacías/preparadas). **Decisión cerrada:** la selección se conserva por ID al cambiar de página; "seleccionar todo" selecciona solo la página visible (dejar hook preparado para un futuro "seleccionar los N que coinciden con el filtro").
9. **Estados visuales:** skeleton rows (no spinner bloqueante), empty real, sin-resultados-por-filtros (con `[Limpiar filtros]`), error (con `[Reintentar]`).
10. **Scroll infinito:** NO en esta versión. La arquitectura del adaptador (`page/pageSize`) debe permitir agregar un modo "vista continua" después sin reescribir. No sacrificar la paginación.
11. **Virtualización:** solo si la auditoría demuestra problemas de render con los pageSize soportados (200 filas normalmente no lo requiere).

## A6. Estado, URL y persistencia

**Fuente de verdad única:** definirla explícitamente (recomendado: URL para estado de sesión, storage para preferencias). No duplicar estado entre URL y memoria.

**URL (`urlSync=true`):** filtros, búsqueda, sort, order, page, pageSize se reflejan en query params:

```text
/cartera?status=late&branch=sucre&overdueMin=90&sort=debt&order=desc&page=1&pageSize=50
```

- Refresh (F5) no pierde estado; back/forward funciona; la URL es compartible.
- **Convención de namespace:** si en el futuro hay dos tablas en una pantalla, los params se prefijan con `tableId`. En esta fase basta con dejar la convención definida y documentada.

**Persistencia de preferencias (por usuario, por tabla):**

```text
clave: tablePrefs:{userId}:{tableId}
contenido: { version, filters, sort, order, pageSize, visibleColumns, columnOrder }
```

- **`version` obligatorio:** si el schema de columnas cambia en el futuro, preferencias viejas hacen fallback a defaults (o migran), nunca rompen la tabla.
- Al volver a la pantalla se restaura exactamente el último contexto (filtros, orden, pageSize, columnas).
- Usar la infraestructura de preferencias existente si la hay; si no, localStorage con la clave anterior.
- **Vistas guardadas** (`Mi cartera`, `Mora crítica`, etc.): NO implementar ahora, pero el schema persistido debe poder evolucionar a múltiples vistas nombradas sin migración dolorosa. Documentarlo.

## A7. Responsive y accesibilidad

- Desktop primero (herramienta administrativa). En pantallas pequeñas: scroll horizontal controlado + columnas prioritarias. No convertir filas en tarjetas si rompe la comparación.
- Keyboard navigation, focus visible, labels, contraste, tooltips donde aporten.
- Ningún estado comunicado solo por color: `🔴` siempre acompañado de texto (`En mora`).

## A8. Consistencia visual y documentación

- Respetar el design system de KOBRAX: colores, tipografía, spacing, radius, shadows, botones, inputs, badges, iconografía. Cero librerías visuales nuevas.
- **Entregar documentación mínima del componente** (README junto al componente o Storybook si existe): props, ejemplo de config, cómo escribir un adaptador, cómo agregar un filterType. Sin esto, nadie lo reutilizará.

---

# CAPA B — CARTERA

## B1. Columnas iniciales

```text
Seleccionar | Cliente | Documento | Deuda | Mora | Créditos | Estado
```

Ocultas por defecto pero disponibles en `⚙ Columnas`:

```text
Sucursal | Cobrador | Último contacto | Fecha de registro
```

Conservar otras columnas existentes solo si no perjudican la UX. No agregar columnas "por tener más información".

## B2. Reglas de negocio de agregación (CRÍTICO)

La API devuelve **una fila por persona** con agregados. Definiciones por defecto — **validarlas contra el modelo real en la auditoría y confirmar con el usuario si difieren**:

| Campo | Regla por defecto |
|---|---|
| **Deuda** | SUMA de saldos pendientes de todos los créditos ACTIVOS (excluye pagados/cancelados). Confirmar en auditoría si incluye capital + interés + penalidades. |
| **Mora** | MÁXIMO de días de mora entre todos los créditos activos. (Persona con un crédito de 450 días y otro al día → muestra 450.) |
| **Créditos** | COUNT de créditos activos. |
| **Estado** | El estado más severo según jerarquía: `En mora > En gestión > Al día > Pagado`. Ajustar la jerarquía a los estados reales del sistema. |

**Filtros sobre agregados:** filtrar `mora > 90` filtra sobre el agregado por persona, no sobre créditos individuales. En SQL esto es `HAVING` (o filtro sobre subquery/vista agregada), no `WHERE` sobre la tabla de créditos.

## B3. Filtros de Cartera

Por columna:

```text
Cliente    → text (nombre / razón social)
Documento  → text
Deuda      → numberRange (Mín / Máx)
Mora       → numberRange (Desde / Hasta, en días)
Créditos   → select (Todos / 1 / 2 / 3 / 4+)
Estado     → multiSelect (Al día / En gestión / En mora / Pagado)
```

Globales (zona superior): `Buscar | Sucursal | Cobrador | Estado | Rango de fechas` + `Más filtros`.

Todos combinables: `Deuda > 10.000 AND Mora > 90 AND Estado = En mora`.

## B4. API / Backend

Evolucionar el endpoint existente (no crear una API paralela). Contrato conceptual:

```text
GET /clients?search=&filters...&sort=debt&order=desc&page=1&pageSize=50

→ { data: [...], meta: { total, page, pageSize, totalPages } }
```

Requisitos:

- Filtros, sorting, paginación y **agregación por persona ejecutados en DB**. El frontend nunca descarga la cartera completa, nunca hace `filter()/sort()` sobre miles de registros.
- La misma capa de query (filtros + sort) debe quedar **reutilizable para un futuro export server-side** — no implementar el export, solo no acoplar la query al formato paginado.
- Cambios backward-compatible si el endpoint es compartido; documentar cualquier cambio de contrato.

## B5. Performance a escala (100.000+ personas)

Decisiones que deben tomarse y documentarse en esta fase:

1. **Índices:** crear/verificar índices sobre columnas filtrables/ordenables y sobre la FK créditos → persona. Listar los índices creados en el entregable.
2. **Costo de la agregación:** medir `SUM/MAX/COUNT` por persona con datos realistas. Si es caro, evaluar (en este orden): query agregada bien indexada → vista materializada → columnas denormalizadas con actualización por evento. **No denormalizar sin evidencia**; si se propone, detenerse y explicarlo primero.
3. **COUNT total:** decidir si `meta.total` es exacto en cada request, cacheado, o aproximado a partir de cierto umbral. Documentar la decisión.
4. **Offset vs keyset:** offset es aceptable para v1; dejar registrado como deuda conocida que páginas profundas degradan y que el adaptador permite migrar a keyset después.
5. **Seed de prueba:** crear un seed de ~100.000 personas / ~300.000 créditos y validar tiempos reales de búsqueda, filtro combinado, sort por deuda y paginación. Reportar mediciones.

---

# ORDEN DE IMPLEMENTACIÓN

```text
FASE 0  Auditoría                    → entregar reporte y ESPERAR revisión
FASE 1  Contrato del genérico        → diseñar A2–A6; validar mentalmente el
                                       contrato contra 2–3 tablas existentes
                                       del sistema (sin migrarlas)
FASE 2  Backend Cartera              → agregación por persona, filtros, sort,
                                       paginación, índices, seed, mediciones
FASE 3  DataTable genérico           → core + Cartera como primer consumidor
FASE 4  Estado y persistencia        → URL sync, preferencias versionadas
FASE 5  UX                           → chips, estados visuales, selección,
                                       columnas configurables, responsive, a11y
FASE 6  Tests                        → ver sección siguiente
FASE 7  Documentación del componente → README/Storybook
FASE 8  Revisión final               → verificar alcance (solo Cartera listado)
```

Si en la Fase 1 el contrato revela que necesita algo de alto impacto, detenerse y explicarlo antes de continuar.

---

# TESTS (dos niveles)

**Nivel 1 — Genérico (con adaptador mock):**
- sorting (3 estados), filtros por tipo, combinación de filtros;
- paginación y cambio de pageSize;
- debounce y anti-race (respuesta vieja nunca pisa a la nueva);
- URL sync (aplicar filtros → refresh → estado intacto);
- persistencia con `version` (prefs corruptas/viejas → fallback a defaults);
- columnas: ocultar/mostrar/reordenar y persistir;
- selección conservada entre páginas;
- estados: loading, empty, no-results, error + retry;
- **cambiar un filtro NO destruye sort, pageSize ni columnas.**

**Nivel 2 — Cartera (integración):**
- agregación correcta: persona con 3 créditos → 1 fila, deuda = suma, mora = máximo, estado = más severo;
- filtro sobre agregados (`mora > 90` usa el agregado);
- combinación real: `mora > 90 + deuda > 10.000 + estado = mora`;
- salir de Cartera → volver → contexto restaurado exactamente;
- contrato de API (`data` + `meta`).

Ejecutar además la suite existente completa y reportar resultados.

---

# CHECKLIST DE VALIDACIÓN MANUAL

```text
□ Buscar "Edgar" (con debounce, sin requests por tecla)
□ Ordenar deuda DESC
□ Filtro mora > 90
□ Combinación: mora > 90 + deuda > 10.000 + estado = mora
□ Paginación: 50 → pág 2 → pág 3 → pág 1
□ Aplicar filtros → salir → volver → estado restaurado
□ Aplicar filtros → F5 → estado en URL se mantiene
□ Sort + filtros se mantienen simultáneamente
□ Filtros imposibles → estado "sin resultados" + [Limpiar filtros]
□ Simular API caída → error + [Reintentar]
□ Seleccionar filas → cambiar página → selección conservada por ID
□ Ocultar/mostrar/reordenar columnas → persistido
□ Desktop y viewport reducido
□ Con seed de 100k: búsqueda, filtro y sort responden sin degradación perceptible
```

---

# NO HACER

❌ Dashboard, KPIs, garantías, detalle de créditos, ficha de cliente.
❌ Migrar otras tablas al genérico en esta fase.
❌ Cargar toda la cartera al frontend; ordenar/filtrar solo lo visible.
❌ Scroll infinito obligatorio.
❌ Todos los filtros visibles a la vez.
❌ Librerías nuevas sin necesidad justificada en la auditoría.
❌ Lógica de dominio (deuda/mora/estados) dentro del core del DataTable.
❌ Denormalizar el schema sin medir primero y sin avisar.
❌ Romper componentes existentes o rediseñar fuera del design system KOBRAX.
❌ Hardcodear formatos (Bs, fechas) en el core.

---

# CRITERIO DE ÉXITO

**Funcional (Cartera):**

```text
Entrar a Cartera → buscar persona → filtrar varias condiciones →
ordenar por deuda/mora → cambiar pageSize → configurar columnas →
salir → volver → encontrar exactamente el mismo contexto
```

**Técnico:**

```text
100.000 personas + filtros + sorting + pagination
= operación 100% server-side, medida con seed realista,
  sin descargar la cartera al navegador
```

**Plataforma:**

```text
DataTable genérico documentado, sin lógica de dominio,
listo para que la siguiente tabla del sistema lo adopte
solo escribiendo su config + adaptador
```

---

# ENTREGABLE FINAL

1. Reporte de auditoría (Fase 0).
2. Archivos modificados y creados (componentes, hooks, services).
3. Decisiones de arquitectura tomadas (agregación, COUNT, offset, persistencia).
4. Cambios de API/DB, índices creados, seed utilizado y mediciones.
5. Documentación del DataTable genérico.
6. Tests agregados y resultados de la suite completa.
7. Deuda técnica detectada y mejoras futuras (keyset, vistas guardadas, export, migración de otras tablas, scroll infinito).

**Esta tarea termina en la tabla de Cartera. No continuar con Cliente/Créditos/Garantías ni migrar otras pantallas.**