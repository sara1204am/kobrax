> **ESTADO: EN BORRADOR — ronda 1 (2026-07-16). NO construir hasta PASS del validador.**
> Overview del módulo. Cada slice se detalla en su propio archivo just-in-time.

## ⏸️ Pendiente de confirmar (retomar con `/f10-etapa import`)
- [x] **Ronda 1 CERRADA (2026-07-22):** la usuaria dio OK a §3 (modelo de origen), §4 (reglas de
      reconcile), §9 (settings) y §10 (pantallas). Único ajuste pedido: la **Vista Previa** antes de
      confirmar debe mostrar explícitamente los baldes *agregados · actualizados · puestos al día*
      (eliminados = 0 por diseño). Incorporado en §6.2 y §14.
- [x] **R3 verificado (2026-07-22):** 18 créditos, 7 con `code` NULL (inocuo en unique de Postgres),
      **0 duplicados** `(accountId, code)` → la migración N4 pasa tal cual.
- [x] **R1 — CERRADO (2026-07-25): calibración MANUAL.** El único extracto disponible
      (`docs/flows/mora union.PDF`) está `VIGENTE` con Moratorios=0 y mezcla `Dias Int.` (18/31/31) con
      `Dias Mora` (30/31/30) en la misma zona → no valida la columna de mora. **Y no se puede
      conseguir uno mejor: el extracto lo emite el banco, nosotros sólo lo leemos** → esperar el
      archivo era esperar para siempre. Decisión de la usuaria: **el usuario elige la columna** en
      Ajustes, viendo 3 valores reales de su propio archivo por candidata (`FIELD-RULES.md` §6.5.1),
      con `Dias Mora` sugerida y guarda `MORA_INCONSISTENTE` en la Vista Previa. **FUNDACION ya no
      está bloqueada para `main`.** Ver §5 y §14.
- [x] **R7 APROBADO (2026-07-22):** `expo-document-picker` (móvil) · `pdfjs-dist` + `xlsx` (API).
- [x] **R2 — DECIDIDO (default lazy):** co-titular (2ª línea del bloque `Cliente`) → **`credit.metadata.coHolder`**
      (string, sin tabla nueva, sin migración, reversible). Promover a `client_relations` es refinamiento
      de la web (§12), no de FUNDACION. Se puede revertir si la usuaria pide co-titular relacional.
- [ ] Al cerrar los 2 bloqueantes restantes: correr `/f10-validar-plan import` → sin **PASS** no arranca el código.

---

# F10 · Módulo IMPORT / Sync diario (móvil) — plan maestro

## Objetivo
Construir la **puerta de entrada de datos del día**: el cobrador/jefe de agencia entra a la app en la
mañana y su cartera queda hidratada desde el archivo que emite su sistema de origen (ej. extracto de
mora del Banco Unión). El flujo arranca **después del login**, se puede **saltar**, y también se
dispara **desde el menú**. Las reglas se definen **una vez en settings**; el import diario es
*elegir archivo → preview → confirmar*.

Fidelidad a los mockups `docs/epics/F10/figma/import/` (9 pantallas), normalizando CTA morado → navy.

---

## 1. Hallazgo crítico — el endpoint que el BUILD-PLAN manda reusar NO cubre este flujo

Auditado contra código real (2026-07-16, `apps/api/src/modules/clients/import/`). El BUILD-PLAN §1 y
la regla de fase "P5" dicen *reusar `POST /api/clients/imports` (`mode` + `dryRun`)*. **No alcanza**, por
tres razones duras:

| # | Realidad del código | Choque con la premisa |
|---|---|---|
| H1 | El servicio **solo escribe `clients`**. Lee `credits` únicamente para *proteger* clientes del borrado; nunca los crea ni actualiza (`client-import.service.ts`). | Toda la premisa (vigente / sin mora / saldo) vive en `credits`. Hoy no la escribe nadie. |
| H2 | `RECONCILE` manda a `toSoftDelete` (→ `status:'INACTIVE', deletedAt:now()`) a todo cliente ausente del archivo (`import-plan.ts:63`). `REPLACE` es **código idéntico**; solo cambia el permiso. | La premisa pide lo **contrario**: el ausente queda **vigente y al día**, jamás borrado. |
| H3 | El match es por `nationalIdHash` (blind index de `nationalId`). Sin documento, toda fila cae en `toCreate`. | **El extracto no trae carnet.** Importar el mismo PDF dos días duplicaría la cartera entera. |

Consecuencia: **este módulo es móvil + backend nuevo.** Se reusa todo lo reusable (§7), pero el motor
de reconciliación de *créditos* no existe y hay que construirlo.

Restricciones adicionales verificadas: no hay multipart en import (el CSV viaja como string en el body,
con el límite de 100 KB por defecto de Express); no hay parser de `xlsx` ni de PDF en ningún
`package.json`; `expo-document-picker` y `expo-file-system` **no** están instalados.

---

## 2. Decisiones cerradas (con la usuaria, 2026-07-16)

| # | Decisión | Implicancia |
|---|---|---|
| **D-ORIGEN** | El discriminador **no es el tamaño ni el `tenantType`** (prohibido, principio #1), sino **si el tenant recibe una lista o carga a mano**, y **si esa lista trae dueño**. Es capacidad + setting. | Una oficina chica con lista de sucursal importa igual que un banco. Un cobrador independiente nunca ve el módulo. |
| **D-SCOPE** | **El alcance del reconcile = el alcance del archivo** (oficial / agencia / sucursal), declarado en settings y contrastado con la cabecera del archivo. | Un PDF de `AGENCIA SUCRE` reconcilia Sucre **y nada más**. Evita que un archivo parcial ponga al día media cartera. |
| **D-PARSER** | **Parseo server-side.** El móvil sube el archivo; la API lo parsea. | Un solo parser para móvil **y** web (la web no reimplementa). El móvil no necesita libs de PDF. El import es en oficina con wifi (§4.1) → no rompe offline. |
| **D-REPARTO** | Si el archivo **no trae dueño**, el reparto es un **paso dentro del import**; no se cierra la corrida sin repartir. | Evita créditos huérfanos. Bloque + ajuste individual. |
| **D-ALCANCE** | El import escribe **cliente + crédito juntos**. | Es lo que el extracto trae y lo que la premisa describe. Obliga a extender el backend (H1). |
| **D-SETTINGS** | Config **corta en la app**; la completa (mapeo visual, perfiles múltiples, defaults por agencia) es **web** → se deja **plan escrito (§12)**, no se construye ahora. | El import diario queda rápido porque las reglas ya están definidas. |
| **D-KEY** | Llave de match = **`No.Credito` → `Credit.code`**. El **crédito es el ancla**, no el cliente. | Único identificador estable del extracto. Se llega al cliente *a través* del crédito (resuelve H3 sin carnet). |

---

## 3. Modelo de origen por tenant

Tres orígenes; dos ejes (alcance del archivo × trae dueño):

| Origen | Alcance | ¿Trae dueño? | Comportamiento | Quién |
|---|---|---|---|---|
| **MANUAL** | — | — | **No ve el módulo.** Alta a mano (módulo Cartera). | Cobrador independiente, oficina que carga a mano |
| **LISTA_ASIGNADA** | Oficial de crédito | Sí | Cada oficial recibe su cartera ya repartida. Sin paso de reparto. | Banco: mora por oficial de crédito |
| **LISTA_A_REPARTIR** | Agencia / Sucursal | No | Un listado; sale el **paso de reparto por cobrador**. | Banco (sección cobranzas) · empresa chica con lista de sucursal |

**Mapeo a columnas que YA existen** (sin inventar nada):

| Alcance | Columna | Filtro del reconcile |
|---|---|---|
| Oficial | `Credit.assignedManagerId` | `assignedManagerId = <oficial declarado>` |
| Agencia / Sucursal | `Credit.branchId` | `branchId = <branch de la cabecera>` |

---

## 4. Reglas de reconciliación (la premisa, detallada)

Universo: **solo créditos dentro del alcance del archivo** (§3) con `metadata.origin = 'import'`.
Los créditos cargados a mano (`origin: 'manual'`) **nunca** se tocan.

| Situación | Acción | Campos |
|---|---|---|
| **En el archivo + existe** (`Credit.code` matchea) | **UPDATE** | `outstandingBalance`, `daysPastDue`, `status`, `interestRate`; nombre del cliente si cambió; `metadata` (producto, instrumento, vencimiento) |
| **En el archivo + NO existe** | **CREATE** cliente + crédito | Cliente (nombre, sin `nationalId`) + crédito con `code`, `origin:'import'`, `branchId`, montos, mora |
| **NO en el archivo + existe en el alcance** | **AL DÍA** — *"como si ya hubiera pagado, vigente sin mora"* | `daysPastDue = 0`, `status = ACTIVE`. **El saldo NO se toca** (pagó la cuota, no el crédito). |
| Fuera del alcance | **INTOCABLE** | — |

**No-negociable de este módulo: el reconcile NUNCA borra ni desactiva.** Se sobrescribe explícitamente
la semántica de `RECONCILE` del motor de clientes (H2). Nada de `toSoftDelete`, nada de `deletedAt`.

`CreditOrigin.IMPORT` de shared ya significa exactamente esto (`packages/shared/src/utils/loan.ts`):
*campos financieros bloqueados en UI, la mora viene del origen y no se recalcula*. Se reusa tal cual.

---

## 5. Parser del extracto Banco Unión (`PRR0785A`)

Muestra: `d:\kobrax\datos\mora union.PDF`. **No es una lista plana**: es un extracto con **un bloque
por crédito** (cabecera + tabla de movimientos). El parser lee bloques, no filas.

**Detección de plantilla:** el texto contiene `REPORTE DE EXTRACTO DE PRESTAMOS` **y** el código de
formulario `PRR0785A`.

**Delimitador de bloque:** línea que abre con `Cliente` + `:`.

**Cabecera → campos** (regex **por etiqueta**, nunca por posición fija de columna):

| Etiqueta en el PDF | Destino | Nota |
|---|---|---|
| `No.Credito:` | `Credit.code` | **LLAVE de match** |
| `Cliente :` | `Client` (titular) | Línea siguiente sin etiqueta = **co-titular** (ver R2) |
| `Estado :` | `Credit.status` | `VIGENTE` → `ACTIVE` (tabla de equivalencias en la config) |
| `Monto :` | `Credit.principalAmount` | |
| `Saldo Credito :` | `Credit.outstandingBalance` | |
| `Tasa Interes :` | `Credit.interestRate` | `7.00 %` |
| `Moneda :` | `Credit.currency` | `BOLIVIANOS` → `BOB` |
| `Fecha Desembolso:` | `Credit.disbursedAt` | `dd/mm/yyyy` |
| `Fec.Vencimiento:` / `Plazo :` / `Producto :` / `Instrumento :` / `Tipo de Credito :` | `Credit.metadata` | |
| `MICROCREDITO AGENCIA <X>` (cabecera de página) | **alcance / `branchId`** | Ancla de D-SCOPE |
| Tabla de movimientos → col. `Dias Mora` (última fila) | `Credit.daysPastDue` | columna **elegible por el usuario**, `Dias Mora` sugerida — R1 |

**Formato de números:** coma = miles, punto = decimal (`859,743.98`). **Paréntesis = negativo**
(`( 4,767.67)` = amortización de capital).

**⚠️ Calibración de `Dias Mora` (R1).** En el layout, `Dias Int.` y `Dias Mora` caen contiguas y el
único archivo de muestra tiene mora=0 → no se puede confirmar cuál columna es cuál solo con él. El
parser aísla `daysPastDue` en una función propia (`extractDaysPastDue(block)`) con:
1. lectura por **coordenada X** del encabezado `Dias Mora` (vía pdfjs, no por offset fijo);
2. **guardas de sanidad**: si `Estado=VIGENTE` y `Moratorios=0`, `daysPastDue` esperado ≈ 0 → un valor
   alto ahí es señal de columna equivocada (se loguea, no se importa a ciegas);
3. un **test de calibración** (`banco-union.calibration.spec.ts` — el plan decía `.test.ts`, el archivo
   real es `.spec.ts`) con el caso VIGENTE (espera mora 0) + un `it.todo` para el caso con mora real.

> ✅ **R1 RESUELTO (2026-07-25) — calibración MANUAL, no por archivo.** El extracto lo emite el banco y
> nosotros sólo lo leemos: **no se puede fabricar uno con mora**, así que esperar el PDF era esperar
> para siempre. La columna pasa a ser **elegible por el usuario**, mostrándole 3 valores reales de su
> propio archivo por cada candidata (`FIELD-RULES.md` §6.5.1). `Dias Mora` sigue siendo la sugerida.
> El `it.todo` se reemplaza por tests que sí corren hoy (que la columna configurada manda), y la
> guarda de sanidad del punto 2 se hace visible como `MORA_INCONSISTENTE` en la Vista Previa.
> **FUNDACION deja de estar bloqueada para `main`.**

---

## 6. Flujo día a día (el corazón del módulo)

### 6.1 Gate post-login
Hook: `src/post-login.ts` → `routeAfterAuth()`. Entra **un paso más**, con la misma forma que
`shouldOfferBiometricSetup()` (predicado async → `router.replace`). Cubre los **4 puntos de entrada**
gratis (splash, offline-retry, unlock, `route-step`).

```
routeAfterAuth():
  … requiresPasswordChange → biometric-setup …
  if (capacidad client:import) && (origen !== MANUAL) && !yaImportóHoy && !saltóHoy
      → router.replace('/import')      ← I1 Inicio Sync
  else → router.replace('/(tabs)')
```

**Flags locales** (SecureStore, patrón exacto de `src/biometric.ts` — cero deps nuevas):
- `k_import_last_day` → `YYYY-MM-DD` de la última corrida **exitosa**.
- `k_import_skip_day` → `YYYY-MM-DD` del último "saltar".

Dos flags separados a propósito: **saltar no es importar**. El gate no vuelve a molestar hoy, pero la
app sigue mostrando "import pendiente". Ambas claves llevan el `userId` (otro usuario en el mismo
equipo no hereda el estado). El logout **no** las borra (es estado operativo, no credencial).

### 6.2 Camino feliz
```
I1 Inicio Sync ──[Ir al Dashboard >]──→ saltar (marca skip_day) → /(tabs)
   │
   ├─[Sincronizar datos]→ Seleccionar Archivo → picker → upload
   │                          → Vista Previa (dryRun) ← OBLIGATORIA, no se salta
   │                          → [Confirmar Importación]
   │                          → Resultado: éxito │ con advertencias
   │                          → si alcance SIN dueño → Reparto por cobrador
   │                          → marca last_day → /(tabs)
   │
   └─[Agregar datos]───→ Carga Rápida → Revisar Lista → Éxito
```

**Vista Previa — qué muestra (obligatoria antes de confirmar).** Es el `dryRun` de N1 renderizado.
Tres baldes, con conteo y lista expandible de *cuáles* (el motor nuevo devuelve los IDs — R6):

| Balde | De dónde | Qué es |
|---|---|---|
| **Agregados** | `plan.toCreate` | créditos + clientes nuevos que entran |
| **Actualizados** | `plan.toUpdate` | créditos existentes cuyo saldo/mora/estado cambia |
| **Puestos al día** | `plan.toSetCurrent` | ausentes del alcance → `daysPastDue=0`, `ACTIVE`, saldo intacto |

**Eliminados = 0, siempre** (§4: el reconcile no borra). Si hay filas `invalid[]`, se listan aparte
(pantalla "con advertencias"). Recién con la preview a la vista se habilita `[Confirmar Importación]`.

### 6.3 Desde el menú
`Más` → **Importar datos** → entra por I1, **mismo flujo, mismo código**. Sin gate, sin flags de día.

---

## 7. Auditoría de reuso (Paso B) — verificada contra código

| Capacidad | Estado | Path |
|---|---|---|
| Parser CSV | **REUSAR** | `apps/api/src/modules/clients/import/csv.ts` (a mano, sin deps, con tests) |
| Multipart | **REUSAR** | patrón `apps/api/src/modules/uploads/uploads.controller.ts` (`FileInterceptor`) |
| Tabla de corridas | **EXTENDER** | `client_import_runs` (+ `template`, `scope`, contadores de crédito) |
| Idempotencia | **REUSAR** | `fileHash` sha256 + `@@index([accountId, fileHash])` |
| Permiso | **REUSAR** | `Permission.CLIENT_IMPORT` (shared) |
| Origen de crédito | **REUSAR** | `CreditOrigin.IMPORT` (shared) — ya = "mora del origen, no recalcular" |
| Campos de mora/estado | **REUSAR** | `Credit.{code,status,daysPastDue,outstandingBalance,branchId,assignedManagerId,metadata}` |
| Estado derivado | **REUSAR** | `portfolioStatus()` (shared) |
| Hook post-login | **EXTENDER** | `src/post-login.ts` (+1 paso) |
| Flag local | **REUSAR** | `expo-secure-store` (patrón `src/biometric.ts`) |
| HTTP autenticado | **REUSAR** | `src/api-client.ts` (`authedFetch`) |
| Subida multipart móvil | **REUSAR** | `src/uploads.service.ts` (FormData + 401→refresh→retry) |
| UI | **REUSAR** | `ui.tsx`: `Header`,`ListRow`,`CaseCard`,`StatTile`,`StatusBadge`,`EmptyState`,`SegmentTabs`,`Chips`,`SectionLabel`,`AmountInput`,`BottomSheet` |
| Patrón form+submit | **REUSAR** | `src/cliente-form.ts` + `app/cliente/nuevo.tsx` (módulo puro testeado + screen) |
| Alta (Carga Rápida) | **REUSAR** | `clients.service.createClient` + `credits.service.createCredit` |
| "Asignar en el mapa" | **REUSAR** | `src/maps/MapPicker.tsx` (fundación de Rutas) |
| KPIs de I1 | **REUSAR** | `cases.service.listCases({view:'portfolio'})` + `src/portfolio.ts` (KPIs en cliente) |

### Artefactos NUEVOS (justificados + ubicados para reuso)
| Artefacto | Path | Por qué |
|---|---|---|
| Parser Banco Unión | `apps/api/src/modules/imports/parsers/banco-union.parser.ts` | No existe ningún parser de PDF. Aislado por plantilla → agregar otro banco = otro archivo. |
| Motor de reconcile de cartera | `apps/api/src/modules/imports/portfolio-plan.ts` | H1/H2: el de clientes no sirve. Función **pura** (espejo de `import-plan.ts`) → testeable sin DB. |
| Endpoint de import de cartera | `apps/api/src/modules/imports/portfolio-import.controller.ts` | multipart + plantilla + créditos. |
| Config por tenant | `account.metadata.importConfig` (JSONB) | El DB_Architecture §Catálogo Flexible ya define este mecanismo (`credit_configuration JSONB por account`). Sin tabla nueva. |
| Service móvil | `apps/mobile/src/import.service.ts` | Ningún service cubre import. |
| Pantalla de reparto | `apps/mobile/app/import/reparto.tsx` | D-REPARTO. Sin mockup. |
| Picker de archivo | dep `expo-document-picker` | No hay forma de elegir archivo. **Dep nueva a confirmar.** |
| Extracción de texto PDF | dep `pdfjs-dist` (API) | Da coordenadas por item → necesario para la tabla posicional. **Dep nueva a confirmar.** |
| Lectura XLSX | dep `xlsx` (API) | Los mockups lo prometen. **Dep nueva a confirmar.** |

---

## 8. Contrato

**Existente (se respeta):** `POST /api/clients/imports` queda **como está**, para el import de *clientes*
por CSV. Este módulo **no lo toca ni lo rompe**.

**Deltas nuevos (a construir):**

| # | Delta | Detalle |
|---|---|---|
| N1 | `POST /api/imports/portfolio` (multipart) | `file` + `dryRun`. Plantilla/alcance/reglas salen de `importConfig` del tenant, **no del body** (por eso el import diario es rápido). Devuelve `{ runId?, scope, plan:{toCreate,toUpdate,toSetCurrent,invalid[]}, counts, needsAssignment }` |
| N2 | `POST /api/imports/portfolio/:runId/assign` | Reparto (D-REPARTO): `[{creditId, assignedManagerId}]` |
| N3 | `GET`/`PATCH /api/imports/portfolio/config` | Config corta (§9). Permiso: `CLIENT_IMPORT`. ⚠️ **Reubicado (2026-07-25):** decía `/api/accounts/me/import-config`, pero **no existe módulo `accounts`** en la API → se cuelga del `@Controller('imports/portfolio')` que ya está. Ver `FIELD-RULES.md` §8.2 item 2. |
| N4 | Migración: `@@unique([accountId, code])` en `credits` | Hace de `code` una llave real (D-KEY). ⚠️ ver R3 |
| N5 | `client_import_runs` + `template`, `scope`, `creditsCreated`, `creditsUpdated`, `creditsSetCurrent` | EXTENDER, no tabla nueva |
| N6 | Límite de tamaño en multer = **15 MB** | Lo que promete el mockup |

**Tablas:** `clients`, `credits`, `client_import_runs`, `accounts` (metadata). Todas con `accountId` (multi-tenant OK).

---

## 9. Settings — versión corta en la app

> 📄 **La pantalla completa vive en `FIELD-RULES.md` §6** (ronda 2, 2026-07-25) — es el plan del slice
> S1 y manda sobre esta tabla. Lo que agregó respecto de acá: tarjeta **Última importación** arriba ·
> alcance **Empresa (todos)** · **Emparejar columnas** (screen propia, columna → campo) ·
> `askOnLogin` · asistente de primera vez. `Manual` colapsa la pantalla a *"Agregar crédito a mano"*.

`Más` → Configuración → **Importación**. Se define una vez; el import diario no vuelve a preguntar.

| Campo | Valores | Destino |
|---|---|---|
| Origen de datos | `Manual` · `Archivo` | `importConfig.source` — `Manual` **apaga el módulo entero** |
| Plantilla ("Formato del archivo") | `Extracto Banco Unión (PDF)` · `Excel` · `CSV` | `importConfig.template` |
| Alcance del archivo | `Oficial` · `Agencia o sucursal` · `Empresa (todos)` | `importConfig.scope` → §3 · el nuevo `kind:'account'` sirve al independiente y autoasigna si hay un solo cobrador |
| ¿El archivo trae el cobrador asignado? | Sí / No | `importConfig.carriesAssignee` → dispara (o no) el reparto |
| Regla de ausentes | `Poner al día` · `No tocar` · `Decidir en cada importación` | `importConfig.absentRule` — default = la premisa. **No hay opción de eliminar** (§4 sigue en pie) |
| Campos del archivo | por campo: `Obligatorio` · `Opcional` · `No importar` + columna | `importConfig.fields` → FIELD-RULES §3 |
| Preguntar al iniciar sesión | Sí / No | `importConfig.askOnLogin` — apagado, sólo se entra por el menú (§6.3) |
| Llave de match | `N° de crédito` (solo lectura) | D-KEY |

**Fuera de la versión corta** (→ web, §12): mapeo visual de columnas, perfiles múltiples por agencia,
tabla de equivalencias de estados editable, programación automática.

---

## 10. Pantallas → slices (node-ids del ui-screen-map §4)

| Slice | Pantallas (mockup · node-id) | Reusa |
|---|---|---|
| **FUNDACION** | (backend, sin pantalla) | `csv.ts`, `uploads.controller`, `client_import_runs` |
| **S1 · Settings** | (sin mockup — §9) | `Chips`,`SectionLabel`,`Header`, patrón `cliente-form` |
| **S2 · Gate + Inicio Sync** | I1 Inicio Sync `24:1049` | `post-login.ts`, `StatTile`, `portfolio.ts` (KPIs) |
| **S3 · Archivo + preview** | Actualizar Archivo `24:1907` · Seleccionar Archivo `24:1981` · Vista Previa `24:2051` | `uploads.service`, `ListRow`, `EmptyState` |
| **S4 · Resultado** | Resultado de Importación `24:2280` · Resultado con Advertencias `24:2164` | `StatTile`,`ListRow`,`StatusBadge` |
| **S5 · Reparto** | (sin mockup — D-REPARTO) | `CaseCard`,`SegmentTabs`,`BottomSheet` |
| **S6 · Carga Rápida** | Formulario `48:1438` · Revisar Lista `24:2468` · Éxito `24:2600` | `cliente-form`, `MapPicker`, `AmountInput`, `ListRow` |

**Build:** 🔵 **dev build** — la frontera ya la cruzó Rutas (MapLibre). S6 usa `MapPicker` ("Asignar en el mapa"), que no corre en Expo Go.

---

## 11. Orden de construcción
`FUNDACION` (parser + motor + endpoint + migración) → `S1` (settings) → `S2` (gate) → `S3` → `S4` → `S5` → `S6`.

`FUNDACION` y `S1` van primero **a propósito**: sin reglas definidas no hay import rápido (D-SETTINGS).

Cada slice: rama `f10/import-<slice>`, verificación (`type-check` + `jest` + `expo export`; API con
`node --import tsx --test`) + `/code-review` + `/ponytail-review` + validación visual, merge limpio
(workflow BUILD-PLAN §2).

---

## 12. Plan para la web (NO se construye ahora — se deja escrito)

Ya en constancia en BUILD-PLAN §4: *IMPORT web admin no existe*. Con este módulo, lo que la web debe
hacer queda acotado, porque **el backend ya estaría hecho**:

1. **Reusa N1–N3 tal cual.** El parser, el motor de reconcile, el alcance y las reglas son server-side
   (D-PARSER) → la web no reimplementa **nada** de la lógica. Es UI sobre endpoints existentes.
2. **`/panel/import`** — subir archivo, preview, confirmar, resultado. Misma corrida, misma tabla.
3. **`/panel/settings/import`** — la versión **completa** de §9: mapeo visual de columnas, **perfiles
   múltiples** (un banco tiene varias agencias con formatos distintos), tabla de equivalencias de
   estados, defaults por agencia/oficial.
4. **Reparto masivo** — la versión de escritorio de S5, con grilla y filtros (el jefe de cobranzas
   reparte cientos de créditos; el móvil sirve para decenas).
5. **Gating** — `CLIENT_IMPORT` (F3). `CLIENT_IMPORT_REPLACE` **no se usa** (ver R5).

---

## 13. Reglas de la fase (además de las 3 de §3.3 del epic)
- CTA morado del Figma → **navy** (design-system §2). Purple solo acento.
- Sol → contraste (montos/mora en navy); gama baja → animación solo en UI thread; animación con propósito.
- **Nada de ramificar por `tenantType`** (D-ORIGEN): se ramifica por capacidad + `importConfig`.
- **El reconcile no borra** (§4). Nunca.
- El motor (`portfolio-plan.ts`) es **función pura** → se testea sin DB, como `import-plan.ts`.
- El móvil **no parsea** (D-PARSER): sube y muestra.

## 14. DoD
- Funcional: importar `mora union.PDF` real → crea cliente + crédito con saldo/mora/estado correctos;
  re-importar el mismo archivo → **cero duplicados** (idempotencia por `fileHash` + `code`); un crédito
  del alcance ausente del archivo → `daysPastDue=0`, `ACTIVE`, **saldo intacto, no borrado**; un crédito
  fuera del alcance → **sin tocar**.
- Vista Previa: obligatoria antes de confirmar; muestra *agregados / actualizados / puestos al día*
  (eliminados = 0) con lista de cuáles; `[Confirmar]` sólo se habilita con la preview cargada.
- Gate: primer login del día → I1; "Ir al Dashboard" → no vuelve a molestar hoy pero **no** marca importado.
- Verificación: `pnpm --filter @kobrax/mobile type-check` + `test` + `npx expo export --platform android`; API `test`.
- Revisión: `/code-review` + `/ponytail-review` verdes.
- **Calibración de mora (R1) — manual:** `banco-union.calibration.spec.ts` verde con el caso VIGENTE
  (mora=0) **y** con `extractDaysPastDue(b,'Int.')===18` / `(b,'Mora')===0` (la columna configurada
  manda). El usuario confirma la columna en Ajustes viendo valores reales (`FIELD-RULES.md` §6.5.1);
  sin confirmar, la Vista Previa avisa. Ya **no** se espera un extracto con mora para mergear.
- Validación visual por la usuaria (emulador / gama baja).

---

## 15. Riesgos y decisiones abiertas

| # | Riesgo | Estado |
|---|---|---|
| **R1** | La muestra tiene `Estado: VIGENTE` y **0 días de mora** → no valida la extracción de mora, y el layout mezcla `Dias Int.` con `Dias Mora`. | ✅ **CERRADO 2026-07-25 — calibración manual.** El extracto es de sólo lectura (lo emite el banco), no se puede fabricar uno con mora → el usuario elige la columna viendo 3 valores reales de su archivo (`FIELD-RULES.md` §6.5.1) + guarda `MORA_INCONSISTENTE` en la preview. Ya no bloquea el merge de FUNDACION. |
| **R2** | La 2ª línea del bloque `Cliente` es un **co-titular** (`MARTINEZ DURAN JUAN ANTONIO`). | **CERRADO: `credit.metadata.coHolder`** (sin tabla/migración, reversible). Relacional = web (§12). |
| **R3** | `@@unique([accountId, code])` (N4): ¿hay `credits.code` duplicados o nulos hoy? La migración falla si los hay. | Verificar antes de FUNDACION |
| **R4** | `COLLECTOR` **no** tiene `CLIENT_IMPORT` en el mapa estático de shared. Un cobrador de banco que opera solo (alcance = oficial) no podría importar. | Decidir con F3/P10 |
| **R5** | `REPLACE` es hoy código idéntico a `RECONCILE`. **No exponerlo en móvil** — la etiqueta mentiría. | Cerrado: no se expone |
| **R6** | `needsReview` del motor viejo descarta los IDs y solo devuelve el conteo → ninguna UI puede mostrar *cuáles*. El motor nuevo **sí** devuelve los IDs. | Cerrado por diseño |
| **R7** | Deps nuevas: `expo-document-picker` (móvil), `pdfjs-dist` + `xlsx` (API). | **APROBADO 2026-07-22** |
