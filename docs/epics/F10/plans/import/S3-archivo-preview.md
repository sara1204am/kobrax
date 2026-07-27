> **ESTADO: ronda 2 (2026-07-27) — correcciones del gate aplicadas (D-N7 se cae, deltas = ninguno).**
> Plan del slice S3 (+ S4, ver §1). Maestro: `README.md`. S1: `FIELD-RULES.md`.

# F10 · Import · S3 — Archivo + Vista Previa (+ S4 Resultado)

## ✅ Decisiones de arranque (2026-07-26)

La usuaria pidió avanzar sin ronda de preguntas; las cuatro abiertas se cierran con el default
razonado y quedan acá para que se puedan revertir sabiendo qué se eligió y por qué.

| # | Decisión | Elegido | Motivo |
|---|---|---|---|
| **D-SPLIT-S3** | Reparto de pantallas | **2 para S3 + 1 para S4** | Derivado de los mockups del repo, no asumido: los pares `24:1907`/`24:1981` y `24:2280`/`24:2164` comparten estructura y sólo cambian de estado (§4). |
| **D-N7** | `GET .../runs/:id` | **Se cae — cero backend** | Revisado contra el esquema (gate, 2026-07-27): `client_import_runs` **no guarda los rechazados**, sólo contadores (`schema.prisma:395-421`). Y §6.3 muestra **la última** corrida, no un histórico — `GET config` ya devuelve ese `lastRun` entero. El endpoint devolvería lo que la pantalla ya tiene en memoria. *"Ver detalle"* navega a `resultado.tsx` en modo lectura con ese objeto. Si algún día hace falta el historial o el detalle por fila, es un slice con migración, no un botón. |
| **D-REPORTE** | "Descargar reporte de errores" | **Se saca del mockup** | No existe generación de reporte, ni librería de salida, ni permiso de escritura a disco. Es un slice propio disfrazado de botón. Los rechazados **igual se ven en pantalla con su motivo**, que es la necesidad real. Queda escrito para la web (§12 del maestro). |
| **D-KPI-I1** | Tarjeta de KPIs del gate | **Deuda de S2** | Es otro slice. Meterla acá infla S3 sin cerrar nada. Anotada en §11 (S3-R3). |

---

## 1. Objetivo

Cerrar el camino del import diario desde que el usuario elige el archivo hasta que ve qué pasó:
**elegir archivo → Vista Previa obligatoria con el detalle de qué cambia → confirmar → resultado**.

Incluye **S4** (pantalla de resultado) por decisión de la usuaria (2026-07-26): hoy se confirma y la app
te manda al dashboard sin decir nada, y el resultado es además lo que destraba *"Ver detalle"* de
Ajustes, que quedó pendiente al cerrar S1 (`b36c92a`).

**Punto de partida real:** S3 **ya existe en versión mínima** en `app/import/index.tsx` (`dcd87a3`),
que su propio comentario declara *"versión mínima del slice S2/S3"*. Ya hace picker → dryRun →
contadores → confirmar. Este slice **completa y reparte**, no construye de cero.

## 2. Rama
`f10/import-s3-archivo-preview`

## 3. Build
🟢 **Sin nativo nuevo.** `expo-document-picker` ya está instalado y en uso (`app/import/index.tsx`,
`app/ajustes/importacion-columnas.tsx`). La app en conjunto ya cruzó a dev build 🔵 por MapLibre
(Rutas), pero este slice no agrega esa frontera.

## 4. Pantallas (node-ids del ui-screen-map §4)

Reparto **derivado de los mockups del repo** (`docs/epics/F10/figma/import/`), no asumido:

| # | Pantalla | node-id | Archivo | Nota |
|---|---|---|---|---|
| 1 | Actualizar Archivo | `24:1907` | `app/import/archivo.tsx` | **Misma pantalla que la 2** |
| 2 | Seleccionar Archivo | `24:1981` | idem | **Estado "listo"** de la 1 |
| 3 | Vista Previa Importación | `24:2051` | `app/import/preview.tsx` | pantalla propia |
| 4 | Resultado de Importación | `24:2280` | `app/import/resultado.tsx` | estado **éxito** |
| 5 | Resultado con Advertencias | `24:2164` | idem | estado **con errores** |

**Por qué 1 y 2 son una sola pantalla:** los dos mockups tienen el mismo dropzone punteado, la misma
caja de requisitos (CSV/XLSX · 15 MB) y difieren únicamente en el título, el copy y el estado del CTA
(`Continuar` gris/deshabilitado vs `Siguiente` navy/activo). Son *antes de elegir* y *listo para
seguir*. Construirlas como dos screens duplicaría el control real de la pantalla.

**Por qué 4 y 5 son una sola pantalla:** mismo `Header` ("Resultado"), misma tarjeta de resumen; la
variante con advertencias suma un banner rojo y la lista de rechazados. Es un condicional sobre
`counts.invalid > 0`, no otra screen.

**Fuera de este slice:** I1 Inicio Sync `24:1049` (S2, ya existe), Revisar Lista / Éxito de Carga
Rápida (S6), reparto (S5).

## 5. Contrato

**Ya construido, se reusa tal cual** (FUNDACION):

| Endpoint | Uso en este slice |
|---|---|
| `POST /api/imports/portfolio` (multipart, `dryRun=true`) | Vista Previa |
| `POST /api/imports/portfolio` (`dryRun=false`) | Confirmar |

La respuesta (`PortfolioSummary`, ya tipada en `src/import.service.ts`) trae **todo lo que las tres
pantallas necesitan**, sin endpoints nuevos:
- `counts: {created, updated, setCurrent, invalid}` → los tres baldes y el resumen del resultado
- `preview.toCreate[] {code, clientName}` · `toUpdate[] {code}` · `toSetCurrent[] {code}` → **la lista
  de *cuáles*** que §6.2 pide y que hoy la UI descarta (R6 existe justamente para esto)
- `preview.invalid[] {index, reason}` → la lista de rechazados del mockup de advertencias
- `preview.warnings[] {index?, code, detail?}` → `MORA_SIN_CONFIRMAR` / `MORA_COLUMNA_SOSPECHOSA`
- `idempotentSkip` → re-subir el mismo archivo del día
- `runId`

> ⚠️ **El `ui-screen-map.md` §4 está desactualizado**: lista `POST /clients/imports` para estas cinco
> pantallas. Ese endpoint **no sirve** para cartera (README §1, hallazgos H1–H3) y fue reemplazado por
> N1. Se corrige el mapa al cerrar el slice.

**Deltas nuevos: NINGUNO** (D-N7 revisado). El slice es 100% móvil; el backend no se toca.

*"Ver detalle"* de Ajustes usa el `lastRun` que `GET .../config` ya devuelve (`import.service.ts:54-62`).

⚠️ **`idempotentSkip` viene con `preview` VACÍA** y los conteos de la corrida anterior
(`portfolio-import.service.ts:118-126` → `emptyPreview()`). No es un archivo sin cambios: es
"este archivo ya se aplicó". Se dibuja como estado propio (§7.1), **nunca** como tres baldes en
cero, que se leería como bug.

**Tablas:** `client_import_runs`, `credits`, `clients` — todas con `accountId`. Ninguna se modifica
en este slice (sólo las escribe el `POST` que ya existe).

## 6. Auditoría de reuso

| Capacidad | Decisión | Path |
|---|---|---|
| Elegir archivo del dispositivo | **EXTENDER → `pickImportFile()`** | Hoy el bloque `DocumentPicker.getDocumentAsync` + mapeo a `PickedFile` está **copiado dos veces**: `app/import/index.tsx:34` y `app/ajustes/importacion-columnas.tsx:51` (que además no filtra por tipo). `archivo.tsx` sería la tercera copia. Se sube a `src/import.service.ts` como `pickImportFile(): Promise<PickedFile \| null>` y **los tres** lo usan. Hallazgo de la usuaria, 2026-07-26. |
| Subida multipart + 401→refresh→retry | **REUSAR** | `importService.run()` (`src/import.service.ts:99`) |
| Flags del día (importado / saltado) | **REUSAR** | `markImported` / `markImportSkipped` (`src/import.service.ts`) |
| Cabecera con back | **REUSAR** | `Header` (`src/ui.tsx`) |
| Contadores de los baldes | **REUSAR** | `StatTile` (`src/ui.tsx`) |
| Filas de registro (código · nombre · monto) | **REUSAR** | `ListRow` (`src/ui.tsx`) |
| Estado vacío / sin archivo | **REUSAR** | `EmptyState` (`src/ui.tsx`) |
| Rótulos de sección | **REUSAR** | `SectionLabel` (`src/ui.tsx`) |
| Banner de error | **REUSAR** | `ErrorBanner` (`src/components.tsx:86`) |
| Botones (primary / ghost / loading) | **REUSAR** | `Button` (`src/components.tsx`) |
| Aviso de sin conexión | **REUSAR** | `OfflineIndicator` (`src/ui.tsx`) |
| Estado de conectividad | **REUSAR** | `useNetStore` (`src/store/net.ts`) |
| Lista larga con corte "mostrar N de M" | **NUEVO (local)** | ver §7.2 |
| Textos de advertencia por código | **EXTENDER** | `WARNING_TEXT` de `app/import/index.tsx` → sube a `src/import.service.ts` para que lo usen preview y resultado |

**Cero componentes nuevos en `ui.tsx`.** Las tres pantallas se arman con lo que ya existe.

## 7. Artefactos nuevos

### 7.1 Screens
| Archivo | Qué es | Justificación |
|---|---|---|
| `app/import/archivo.tsx` | Picker (2 estados) | Sale de `index.tsx`, que hoy mezcla gate + picker + preview. El mockup los separa. |
| `app/import/preview.tsx` | Vista Previa | Pantalla propia en el mockup; además la lista de *cuáles* no entra debajo del picker. |
| `app/import/resultado.tsx` | Resultado (2 estados) | S4. |

`app/import/index.tsx` queda **sólo** como I1 Inicio Sync (gate): bienvenida + CTAs. La tarjeta de
KPIs que pide el mockup es **deuda de S2** — ver §11.

`resultado.tsx` tiene **tres** estados, no dos: éxito · con advertencias · **modo lectura** (llega
desde *"Ver detalle"* con un `LastRun`, que sólo trae conteos: sin listas y sin CTA de confirmar).

### 7.2 `BucketList` — local a `preview.tsx`
Lista colapsable de un balde (título + conteo + primeros N + "Mostrar N de M"). Vive **dentro de
`preview.tsx`**: la usan los tres baldes de esa pantalla y nadie más. Si el resultado o la web la
necesitan, se sube a `ui.tsx` entonces — no antes.

**Se copia el patrón que ya existe**, no se inventa otro: `app/(tabs)/agenda.tsx:131,212`
(`showAll` + `slice(0, N)` + "Ver más (N)"), también local a su pantalla.

## 8. Tareas

0. **Deduplicar el picker**: extraer `pickImportFile()` a `src/import.service.ts` y hacer que
   `app/import/index.tsx` y `app/ajustes/importacion-columnas.tsx` lo usen. Va **primero** para que
   `archivo.tsx` nazca usándolo en vez de agregar la tercera copia.
1. Subir `WARNING_TEXT` de `index.tsx` a `src/import.service.ts` (lo van a usar 3 pantallas), junto
   con el mapa `ProfileKind → "Formatos soportados: …"` que pide S3-R5.
2. `app/import/archivo.tsx`: dropzone + caja de requisitos + CTA con los dos estados; al elegir,
   `dryRun` y navegar a preview pasando el archivo. Errores con `ErrorBanner`, sin navegar.
3. `app/import/preview.tsx`: tres `StatTile` + `BucketList` por balde + rechazados + advertencias de
   corrida + `[Confirmar Importación]`. Sin preview cargada **no** se puede confirmar (§6.2).
4. `app/import/resultado.tsx`: los dos estados; `markImported()` acá (no antes: recién con el POST
   real aplicado el día está importado); CTA → `/(tabs)`.
5. Adelgazar `app/import/index.tsx` a gate puro (I1).
6. `[ Probar con un archivo ]` en Ajustes (§7 P1 de FIELD-RULES): navega a `archivo.tsx` en modo
   prueba — llega a preview y **no** ofrece confirmar.
7. Enganchar *"Ver detalle"* de `app/ajustes/importacion.tsx` (la fila que quedó pendiente al cerrar
   S1) a `resultado.tsx` **en modo lectura**, pasándole el `lastRun` que la pantalla ya tiene. Sin
   backend (D-N7).
8. Tests de los derivados puros nuevos (corte de listas, texto de advertencias, estado del CTA).
   Al mover el `dryRun` a `archivo.tsx`, **borrar** el `res as unknown as PortfolioSummary` de
   `app/import/index.tsx:52` — la rama ok de `FileResult<T>` ya es `{ status:'ok' } & T`, el cast
   sobra y no se copia a tres pantallas.
9. Corregir `ui-screen-map.md` §4: endpoint real N1 en las 5 filas.

## 9. Reglas de la fase

- Las 3 de §3.3 del epic: **sol → contraste** (montos y códigos en navy, nunca en gris suave);
  **gama baja → perf en UI thread**; **animación con propósito**.
- **CTA morado del Figma → navy** (design-system §2). El `Sincronizar datos` morado de I1 y los CTAs
  de estas pantallas van en navy; purple sólo acento.
- **La Vista Previa es obligatoria y no se saltea** (§6.2 del maestro).
- **Eliminados = 0, siempre.** No se dibuja un balde de eliminados ni aunque venga en 0: el reconcile
  no borra (§4) y mostrar el balde sugeriría que podría.
- **El móvil no parsea** (D-PARSER): sube y dibuja lo que la API devuelve.
- Nada de ramificar por `tenantType`.
- Listas largas: cortar a N y ofrecer ver el resto. Un archivo de 150 registros no se dibuja entero
  en un teléfono de gama baja.

## 10. DoD

- **Funcional**: elegir `mora union.PDF` → preview muestra los tres baldes **con la lista de cuáles**
  y las filas inválidas con su motivo → confirmar → pantalla de resultado con los conteos reales →
  `markImported` marcado → el gate no vuelve a ofrecer hoy.
- Re-subir el mismo archivo el mismo día → `idempotentSkip` con su **estado propio** ("este archivo
  ya se aplicó", con los conteos de esa corrida), sin duplicar y sin baldes vacíos.
- *"Ver detalle"* de Ajustes abre el resultado en modo lectura con los conteos de la última corrida.
- Sin preview cargada, `[Confirmar]` no existe.
- Un archivo con filas inválidas → estado "con advertencias", con los registros rechazados listados.
- Sin conexión → mensaje claro ("el import se hace en la oficina, con wifi"), sin romper.
- **Verificación**: `pnpm --filter @kobrax/mobile type-check` + `test` + `npx expo export --platform android`.
- **Revisión**: `/code-review` + `/ponytail-review` verdes.
- **Validación visual** por la usuaria, por cable.

## 11. Riesgos y decisiones abiertas

| # | Tema | Estado |
|---|---|---|
| **S3-R1** | **N7** (`GET .../runs/:id`). Sin él, *"Ver detalle"* de Ajustes no se puede construir. | **CERRADO (D-N7 revisado en el gate): se cae.** La premisa era falsa — sí se puede construir, con el `lastRun` que `GET config` ya devuelve. Lo único que N7 agregaría es el **detalle por fila de una corrida pasada**, que no está persistido en ningún lado (`client_import_runs` guarda conteos). Eso es un slice con migración. |
| **S3-R2** | *"Descargar reporte de errores"* (CTA del mockup `24:2164`). No existe generación de reporte en el backend, ni librería de CSV/PDF de salida, ni permiso de escritura a disco en el móvil. Es un slice propio, no un botón. | **CERRADO (D-REPORTE): se saca**, escrito para la web (§12 del maestro). Los rechazados se ven en pantalla con su motivo. |
| **S3-R3** | La tarjeta de KPIs de I1 (`clientes totales`, `rutas activas`, `saldos pendientes`, `total registros`) no está construida. Es **S2**, no S3. `portfolio.ts` + `cases.service.listCases({view:'portfolio'})` la cubrirían en cliente. | **CERRADO (D-KPI-I1): deuda de S2.** Anotada acá para que no se pierda. |
| **S3-R4** | El mockup de Vista Previa muestra una tabla plana `nombre · ID · monto`, **no** los tres baldes. El README §6.2 (ronda 1, cerrada con la usuaria) manda los baldes. | **Cerrado: manda el README.** Se toma del mockup la *idea* de la lista de registros, y se aplica **por balde**. |
| **S3-R5** | Los mockups dicen "Formatos soportados: CSV, XLSX" pero el motor real lee además PDF (`pdf-blocks`), que es el caso del Banco Unión. | **Cerrado**: el copy sale de la config del tenant (la forma elegida en Ajustes), no un literal del mockup |
