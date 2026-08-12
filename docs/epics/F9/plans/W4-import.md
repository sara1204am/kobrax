> **ESTADO: EN BORRADOR — ronda 1 (2026-08-11). NO construir hasta PASS.**
>
> Ronda 1 cierra las tres decisiones de la dueña (11/08): **Excel sí** · **el reparto queda
> fuera** · **la vista previa muestra la lista completa**. Y corrige un supuesto del BUILD-PLAN
> que ya no es cierto: **Excel ya se lee** (§4.6). Ver §5 y §13.

# W4 — Import

## 1. Objetivo

Que la cartera del día entre **desde la oficina, en pantalla grande, sin adivinar**: subir el
archivo que emite el sistema del cliente, ver las 200 filas que van a cambiar, y recién ahí
confirmar.

Hoy el import existe sólo en el teléfono, y ahí es un compromiso: la vista previa corta en 8
ítems (`LIST_LIMIT`), emparejar 12 columnas se hace en una lista vertical, y el archivo suele
llegar por correo a una computadora. **El gap que el móvil dejó anotado es exactamente éste**:
el import de oficina se hace en el escritorio.

W4 es además la etapa que **le da a `shared` el contrato del import** (`BUILD-PLAN §3.9`): el
móvil escribió las reglas del emparejado y hoy viven en `apps/mobile/src/import.service.ts`,
donde la web no las ve.

## 2. Rama

`web/W4-import`, **sale de `main`** (`2b7c059`, con W0–W3 adentro).

A diferencia de W3, no hay motivo para salir de otra rama: W3 ya está mergeada y W4 no depende
de nada suyo salvo el `DataTable` y el kit de UI, que están en `main`. 🔴 **Verificar antes de
la primera línea que `git log -1` de la rama es descendiente de `2b7c059`** — la rama de Cuenta
del móvil salió de un commit viejo y el merge terminó con dos copias de dos componentes sin que
git marcara conflicto.

## 3. Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/import` | `client:import` | El import del día: elegir archivo → vista previa → confirmar → resultado. Y la tarjeta de la última corrida |
| `/import/ajustes` | `client:import` | Origen, alcance, forma del archivo, reglas de ausentes, reiniciar |
| `/import/ajustes/columnas` | `client:import` | Emparejar columnas con un archivo de muestra + confirmar la columna de mora |

🔴 **Rutas privadas nuevas → al matcher de `middleware.ts`** con `/import/:path*`. Es el error
más fácil de cometer: la pantalla anda hasta que expira el access token, 15 minutos después.

En `lib/nav.ts` se le da vuelta el `built: false` a `import`. Ya tiene su `permission:
Permission.CLIENT_IMPORT` puesto.

### 3.1 Por qué el flujo del día es UNA pantalla y no cuatro

El móvil tiene cuatro (`/import/index`, `archivo`, `preview`, `resultado`) porque navega con
parámetros de string: el archivo viaja como `uri` y cada pantalla lo vuelve a abrir del disco.

**En el navegador eso no se puede**: un `File` no sobrevive a un `router.push` — no es
serializable y no hay `uri` que reabrir. Pasar por una ruta nueva significaría volver a pedirle
el archivo al usuario. Así que `/import` es un client component con **tres estados** (elegir ·
vista previa · resultado) sobre el mismo `File` en memoria.

No es una simplificación de comodidad: es la única forma que existe del lado del navegador.

## 4. Contrato (verificado contra el controller, el service y los parsers)

### 4.1 Los tres endpoints

| Endpoint | Permiso | Notas |
|---|---|---|
| `GET /imports/portfolio/config` | `client:import` | Devuelve `{ config, catalog, lastRun, members, branches }` — **todo en una llamada** |
| `PATCH /imports/portfolio/config` | `client:import` | Devuelve `{ config }` ya validada. Un campo en `null` se **quita**; `{ reset: true }` vuelve a fábrica |
| `POST /imports/portfolio` | `client:import` | multipart, campo `file`, **15 MB**. `dryRun` y `?columnsOnly=true` abajo |

🔴 **`dryRun` y `columnsOnly` no viajan igual**: `dryRun` es un **campo del multipart**
(`@Body('dryRun')`, string `'true'`), `columnsOnly` es un **query param** (`?columnsOnly=true`).
Mandar `dryRun` por query hace que el POST **aplique la importación de verdad** creyendo que
está previsualizando. Es el error más caro de esta etapa.

### 4.2 Lo que devuelve una corrida (`PortfolioSummary`)

```
{ dryRun, idempotentSkip, runId?, scope,
  counts:  { created, updated, setCurrent, invalid },
  preview: { toCreate[{code, clientName}], toUpdate[{code}], toSetCurrent[{code|null}],
             invalid[{index, reason}], warnings[{index?, code, detail?}] } }
```

**Tres baldes, no cuatro: «eliminados» no existe.** El reconcile nunca borra — ni en cero se
dibuja, porque un balde en cero sugiere que podría haberlo.

`toSetCurrent` son los créditos que **ya tenés y el archivo no trae**: quedan vigentes y sin
atraso, el saldo no se toca. Es la regla `absentRule` en acción.

### 4.3 Lo que devuelve `?columnsOnly=true`

```
{ labels[], columnCandidates[{header, samples[{label, value}]}],
  recordStartCandidates[{text, count}], headerCandidates[{anchor, preview}] }
```

Los dos últimos vienen vacíos salvo en su forma: `recordStartCandidates` sólo en `pdf-blocks`
(qué etiqueta abre cada registro), `headerCandidates` sólo en `pdf-rows` (cuál de las filas de
arriba son los encabezados). Una planilla no pregunta nada.

### 4.4 Las reglas del servidor que la pantalla tiene que respetar

Verificadas en `import-config.ts` y `portfolio-import.service.ts`. Si la UI no las conoce,
ofrece botones que la API rechaza.

1. **Los 7 invariantes de la config los valida el `PATCH`**, no la UI: no importar + obligatorio
   se contradicen · obligatorio sin emparejar revienta el 100 % de las filas · `code` y
   `clientName` no se apagan ni se quitan (`locked`) · cambiar la **forma** invalida todo el
   emparejado · una columna no alimenta dos campos · el alcance `account` no lleva `ref` y los
   otros dos lo exigen · `calibrated` es sólo de `daysPastDue`.
2. **Elegir la columna de mora y confirmarla son dos llamadas** (`CALIBRATION_STALE`). Si se
   pudiera en una, «confirmado» no significaría nada: el usuario nunca vio los valores nuevos.
3. **`source: 'manual'` desactiva el import entero** (`IMPORT_DISABLED`). La pantalla `/import`
   lo dice y manda a Ajustes; no ofrece dropzone.
4. **La forma del archivo la deciden los bytes, no la config** (`assertFileShape`): PDF con
   perfil de planilla → `FILE_SHAPE_MISMATCH`; `.xls` viejo → `XLS_LEGACY_NOT_SUPPORTED`, con
   el arreglo adentro del mensaje.
5. **Cero registros leídos = el perfil está mal, no el archivo** (`NO_RECORDS_MAPPED`). El
   mensaje ya manda a Ajustes: la web lo muestra, no lo reescribe.
6. **Mismo archivo ya aplicado = no-op** (`idempotentSkip`), y llega con los conteos de aquella
   corrida y **sin listas**. No es «no pasó nada»: se dice «este archivo ya se importó».
7. **El import escribe clientes sin carnet**: el archivo no lo trae. Un cliente sin nombre entra
   como `SIN NOMBRE` — por eso `code` y `clientName` están `locked`.

### 4.5 Errores que la pantalla tiene que saber traducir

`IMPORT_DISABLED` · `IMPORT_NOT_CONFIGURED` · `FILE_SHAPE_MISMATCH` ·
`XLS_LEGACY_NOT_SUPPORTED` · `NO_RECORDS_MAPPED` · `PARSE_FAILED` · `SIGNATURE_MISMATCH` ·
`FILE_REQUIRED` · y los de config: `FIELD_RULE_CONFLICT`, `FIELD_NOT_MAPPED`,
`COLUMN_ALREADY_MAPPED`, `UNKNOWN_FIELD`, `PROFILE_CHANGED`, `CALIBRATION_STALE`,
`INVALID_SOURCE`, `INVALID_PROFILE_KIND`.

> **La API ya trae el mensaje en español y es específico.** El panel es bilingüe, así que en
> `es` se muestra el del servidor y en `en` se traduce por código, cayendo al del servidor
> cuando el código no está en el diccionario. Un código nuevo del backend **se muestra crudo,
> no se esconde** — misma regla que `warningText` en el móvil.

### 4.6 🔴 C13 del BUILD-PLAN está desactualizado: **Excel ya se lee**

El BUILD-PLAN dice «la dep `xlsx` nunca se instaló y `rows.parser` sólo hace CSV». Ya no:

- `apps/api/package.json` tiene **`exceljs ^4.4.0`** instalado.
- `rows.parser.ts` tiene `parseXlsxRows()`, y `parseRowsFile()` **decide por los bytes**
  (`PK\x03\x04` → Excel, si no CSV). Los dos caminos terminan en el mismo `readRows`.
- El controller ya acepta los mime de `.xlsx` y `.xls` en `ACCEPTED_MIME`.
- `.xls` de Excel 97-2003 se rechaza **a propósito** y con el arreglo en el mensaje.
- Va `exceljs` y no `xlsx` porque SheetJS quedó en 0.18.5 en npm, con prototype pollution y
  ReDoS sin arreglar ahí. Esto parsea archivos que sube el usuario.

**Consecuencia para W4: la decisión 1 de la dueña ya está cumplida, y mejor de lo pedido. W4 no
instala ninguna dep.** Lo único que queda de esa decisión es **el copy**: el móvil todavía dice
«CSV · si tu sistema exporta Excel, guardalo como CSV» (`PROFILE_META.rows.format`), que hoy es
mentira. Ese texto se queda en el móvil (es texto), pero **se corrige ahí también** — tarea T8.

### 4.7 Nuevo en el BFF

| Handler | Qué proxea |
|---|---|
| `GET`/`PATCH /api/imports/config` | `GET`/`PATCH /imports/portfolio/config` vía `apiCall` |
| `POST /api/imports/run` | `POST /imports/portfolio` — **multipart, pasa el `FormData` tal cual**, y reenvía el `?columnsOnly` que le llegue |

El multipart copia el patrón de `api/account/upload/route.ts`: `fetch` crudo con
`bearerHeaders()` y `body: await req.formData()` — **no `apiCall`**, que fuerza
`content-type: application/json` y rompería el boundary. Con su `try/catch` a mano (la API
caída en un handler sin `apiCall` tira excepción, que es lo que W1 vino a sacar).

`sameOrigin()` en los dos que mutan (`PATCH` y `POST`).

## 5. Las tres decisiones de la dueña (11/08) — cerradas

| # | Decisión | Qué implica |
|---|---|---|
| D1 | **Excel sí** | Ya está (§4.6). W4 sólo lo dice en el copy: «CSV o Excel (.xlsx)» |
| D2 | **El reparto queda FUERA** | W4 cierra el camino de importar: configurar, previsualizar, confirmar. Repartir la cartera entre cobradores se hace desde Cartera, que ya existe. El toggle «¿el archivo trae el cobrador?» (`carriesAssignee`) **sí** se muestra: es config de lectura del archivo, no reparto |
| D3 | **La vista previa muestra la lista COMPLETA** | Con `DataTable`, no el corte de 8 del móvil. Es justo lo que aporta la pantalla grande |

## 6. Lo que se promueve a `shared`

Regla del BUILD-PLAN §3.9: **va la regla, nunca el texto en un idioma.** Promover = mover,
dejar el móvil importando de ahí, y verificar que **sus tests pasan sin tocarlos**.

### Sí van

| Qué | A dónde |
|---|---|
| Tipos del contrato: `ProfileKind`, `AbsentRule`, `ScopeKind`, `NameOrder`, `FieldRule`, `ImportConfig`, `ImportConfigPatch`, `FieldDef`, `LastRun`, `ScopeMember`, `ScopeBranch`, `ConfigScreen`, `ColumnCandidate`, `ColumnsPayload`, `PortfolioSummary` | `src/types/import.types.ts` |
| `FieldState` + `fieldState()` + `applyFieldState()` | `src/utils/import.ts` |
| `SetupStep` + `setupStep()` | idem |
| `previewName()` — el orden `APELLIDO APELLIDO NOMBRE` **es** una regla, espejo de `splitName` de la API | idem |
| `soleAssignee()` | idem |
| `ResultKind` + `resultKind()` | idem |

Barriles: `types/index.ts` y `utils/index.ts`. ⚠️ Ojo con las colisiones de nombre — en W3
`hasChanges` ya estaba ocupado y el diff de cliente terminó como `hasClientChanges`. Acá los
candidatos a chocar son `FieldRule` y `FieldDef` (`client.types.ts` tiene lo suyo de
formularios): **revisar antes de exportar**, y si chocan, el del import se llama
`ImportFieldRule`/`ImportFieldDef` y el móvil lo re-exporta con el nombre viejo.

### No van (texto en un idioma, o es del teléfono)

`PROFILE_META` · `SCOPE_META` · `ABSENT_RULE_META` · `FIELD_STATE_META` · `NAME_ORDER_LABEL` ·
`warningText` · `rejectText` · `lastRunWhen` · `scopeRefName` (devuelve «El elegido ya no está
disponible») · `moreLabel` · `LIST_LIMIT` (es el techo de un teléfono de gama baja) ·
`decideImportGate`, `shouldOfferImport`, `markImported`, `markImportSkipped`,
`rememberSampleFile`/`recallSampleFile`/`forgetSampleFile` (SecureStore + el gate post-login,
que **la web no tiene**: en el escritorio no hay «al iniciar sesión te ofrezco importar»).

La web reescribe todo eso como claves de i18n en `panel.import` (§7). El nombre del `scope.ref`
lo resuelve la pantalla con dos líneas contra `members`/`branches`.

> **`askOnLogin` se muestra igual** aunque sea una regla del móvil: es config **del tenant**, y
> la supervisora la administra desde la oficina. El subtítulo dice de quién es («aplica a la app
> del cobrador»), que es más honesto que esconderla.

## 7. i18n

Namespace nuevo `panel.import` en `src/messages/{es,en}.json`. `messages.test.ts` falla si una
clave existe en un idioma y no en el otro.

Grupos: `nav`/`crumbs` (`ajustes`, `columnas` en `panel.crumbs`) · `run.*` (dropzone,
requisitos, los tres baldes, el confirmar, el resultado) · `settings.*` (origen, alcance, forma,
reglas, reset) · `columns.*` (estados de campo, orden del nombre, calibración) · `errors.*` (los
códigos de §4.5) · `warnings.*` (`MORA_SIN_CONFIRMAR`, `MORA_COLUMNA_SOSPECHOSA`,
`MORA_INCONSISTENTE`) · `rejects.*` (`NO_CODE`, `DUP_IN_FILE`, `MATCHES_MANUAL`,
`MATCHES_OUT_OF_SCOPE`, y el prefijo `MISSING_*` que se colapsa en un solo texto).

**Las etiquetas del catálogo de campos vienen del servidor** (`catalog[field].label`, en
español) y **no se traducen**: son los nombres canónicos del dominio, y el catálogo es el que
manda. Si algún día el panel en inglés los quiere, se traducen en la API, no en dos lugares.

## 8. Tareas

| # | Tarea | Sale verde con |
|---|---|---|
| T1 | Promover a `shared` los tipos + los 6 derivados puros. El móvil importa de ahí; `import.service.ts` se queda con la red, los flags y los `*_META` | `shared` build + 46 · móvil type-check + **310 sin tocar un test** |
| T2 | BFF: `api/imports/config/route.ts` (GET+PATCH) y `api/imports/run/route.ts` (POST multipart + `columnsOnly` passthrough) | type-check + tests de handler |
| T3 | Matcher de `middleware.ts` (`/import/:path*`), `nav.ts` → `built: true`, esqueleto de `panel.import` en los dos idiomas | `nav.test.ts` + `messages.test.ts` |
| T4 | `/import/ajustes`: origen · alcance (+ su `ref` contra `members`/`branches`) · forma · `carriesAssignee` · reglas de ausentes · `askOnLogin` · reiniciar (con confirmación en `Modal`) · tarjeta de la última corrida | pantalla + `lib/import.ts` con tests |
| T5 | `/import/ajustes/columnas`: subir muestra (`columnsOnly`) · la tabla de campos (estado + origen) · agregar/quitar campo · orden del nombre con `previewName` sobre un nombre real · señalar dónde arranca la tabla (PDF) · **la calibración de mora en dos pasos** | pantalla + tests del paso a dos llamadas |
| T6 | `/import`: dropzone (click + drag&drop nativo) → `dryRun` → vista previa → confirmar → resultado. Tres estados, un `File` | pantalla |
| T7 | La vista previa con `DataTable`: **lista completa**, un bloque por balde, y el de rechazos con su motivo traducido | `DataTable` reusado sin tocarlo |
| T8 | Corregir el copy de Excel en el móvil (`PROFILE_META.rows.format`) y **C13 en el BUILD-PLAN** | móvil verde |

## 9. La vista previa con `DataTable` (D3)

`DataTable` está hecho para listas **paginadas por la API**: el orden y la página viven en la
URL. La vista previa es una lista **en memoria** y no tiene ni una cosa ni la otra.

Se reusa igual, con dos precisiones:

- `meta = { total: n, page: 1, limit: n, pages: 1 }` → **el pie de paginación no se dibuja**
  (`meta.pages > 1` es falso). Sin componente nuevo.
- **Todas las columnas `sortable: false`.** Ordenar hace `router.push` con searchParams nuevos,
  y esta pantalla tiene el archivo en el estado de un client component: una navegación blanda
  la remonta y **se pierde el `File`**, o sea el usuario vuelve a la dropzone después de esperar
  la lectura. Si algún día se quiere ordenar la previa, se ordena el array en cliente, no por URL.

`ponytail:` se dibujan **todas** las filas, sin virtualizar. Un archivo de 3.000 créditos son
3.000 `<tr>` — el navegador de escritorio los aguanta y es exactamente lo que D3 pidió ver. Si
aparece un tenant con decenas de miles, el techo se sube con `content-visibility: auto` en las
filas antes que con una librería.

## 10. Tests

Vitest, **por lógica no trivial, no por componente** (regla de `apps/web/CLAUDE.md`).

| Qué | Dónde |
|---|---|
| Los 6 derivados promovidos | ya tienen cobertura en `apps/mobile/src/import.service.test.ts` — **tiene que seguir pasando sin tocarse** |
| Código de error → clave de i18n (con el fallback al mensaje del servidor y el código crudo desconocido) | `lib/import.test.ts` |
| Motivo de rechazo → texto, incluido el prefijo `MISSING_*` | idem |
| La calibración manda **dos** `PATCH` y no uno | test de la lógica de `columnas`, no del componente |
| El `FormData` de la corrida lleva `dryRun` **como campo** y `columnsOnly` **como query** | test del handler del BFF, con MSW |
| El handler de multipart no usa `apiCall` y sobrevive a la API caída (502, no excepción) | idem |

## 11. Verificación

```
pnpm --filter @kobrax/shared build && pnpm --filter @kobrax/shared test
pnpm --filter @kobrax/mobile type-check && pnpm --filter @kobrax/mobile test   # 310, sin tocarlos
pnpm --filter @kobrax/api type-check && pnpm --filter @kobrax/api test          # 541
pnpm --filter @kobrax/web type-check && pnpm --filter @kobrax/web test && build
```

Y el recorrido por cable, que en el módulo de import del móvil destapó **4 defectos que ninguna
prueba veía**: subir un CSV, un `.xlsx` y un PDF; cambiar la forma y verificar que el emparejado
se resetea; confirmar dos veces el mismo archivo y ver el `idempotentSkip`.

🔴 **Sigue faltando un extracto real CON mora** (la muestra que hay está vigente, con 0 días).
Es el bloqueante que el módulo del móvil dejó anotado y **W4 no lo resuelve**: sin él, la
calibración de la columna de días de atraso se prueba con ceros, que es justo el caso que no
distingue una columna bien elegida de una mal elegida.

## 12. Trampas y riesgos

- 🔴 **`dryRun` es campo del multipart, `columnsOnly` es query** (§4.1). Confundirlos importa
  de verdad creyendo que previsualiza.
- 🔴 **El `fileFilter` del controller rechaza por mime y devuelve `FILE_REQUIRED`**, o sea
  «Falta el archivo» ante un archivo que el usuario claramente eligió. En Windows un `.csv`
  puede llegar con `type: ''`. La pantalla **re-envuelve el `File` con un tipo deducido de la
  extensión** cuando viene vacío (3 líneas) y traduce `FILE_REQUIRED` como «ese tipo de archivo
  no se acepta», no como «falta el archivo».
- **El archivo se sube DOS veces**: una para la vista previa (`dryRun`) y otra al confirmar. Es
  así también en el móvil, y es correcto — la previa no guarda nada, y entre una y otra la
  cartera pudo cambiar. Con 15 MB por vuelta hay que mostrar progreso, no una pantalla quieta.
- **El `POST` corre el reconcile dentro de una transacción**: un archivo grande puede tardar. No
  hay techo de espera puesto en ningún lado (el móvil tampoco lo puso — quedó anotado como
  pendiente). Definir uno acá o dejarlo explícitamente anotado.
- **`await req.formData()` en el handler del BFF bufferea los 15 MB en el server de Next.**
  `ponytail:` es el patrón que ya usa `account/upload` y a este volumen no duele; el día que
  duela, se reenvía `req.body` como stream con `duplex: 'half'`.
- ⚠️ **Tocar `shared` obliga a reiniciar el `dev` de la web** (`resolve.symlinks = false`). El
  síntoma es `X is not a function` sobre algo recién exportado. T1 toca `shared`: reiniciar.
- ⚠️ Los strings de i18n viajan serializados en el HTML: buscar una palabra suelta da falsos
  positivos. Buscar el markup (`>Texto<`).
- ⚠️ Un mensaje de commit con comillas dobles rompe el here-string de PowerShell, y uno con una
  ruta tipo `/import` puede disparar un guard del harness → `git commit -F archivo`.
- **Los spec de la API se listan a mano en su `package.json`.** Si W4 agregara un spec allá (no
  debería: no toca la API), hay que sumarlo a esa lista o no corre.

## 13. Fuera de alcance (dicho para que no se pida después)

- **El reparto de la cartera importada** (D2) — se hace desde Cartera.
- **El gate post-login** «¿importás hoy?» — es del móvil; en el escritorio se entra por el menú.
- **El histórico de corridas**: la API guarda **conteos**, no el detalle por fila, y sólo expone
  `lastRun`. «Ver detalle» son esos mismos números en grande, igual que en el móvil. Un
  histórico real es un endpoint nuevo, y por lo tanto otra etapa.
- **`POST /clients/imports`** (el import viejo de clientes): matchea por carnet y borra al
  ausente. **No se usa** (C4).
