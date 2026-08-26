# Emparejar columnas (`/import/ajustes/columnas`) — estado para revisión

**Fecha:** 25/08/2026 · **Rama:** `main` @ `359097c`
**Alcance:** describir qué hay en la pantalla de emparejado, cómo funciona, qué reglas del servidor la condicionan y dónde se traba el usuario.

> ⚠️ **Este documento describe el ANTES.** El mismo 25/08 la pantalla se rehízo sobre estos
> hallazgos y **dejó de existir como ruta propia**: vive dentro de `/import/ajustes` — ver
> [`import-rediseno.md`](./import-rediseno.md). Las §5 «lo que el móvil resolvió», §6 «roces» y §8
> «lo que conviene no romper» siguen siendo la referencia de por qué quedó como quedó.

> Documento hermano: [`import-ajustes.md`](./import-ajustes.md) (la pantalla padre, `/import/ajustes`).

---

## 1. Qué es y cómo se llega

Es la pantalla que **hace configurable un formato que nunca vimos**: la persona sube SU archivo, la API le dice qué etiquetas encontró, y acá se declara qué columna alimenta qué dato de la cartera.

Es el paso que habilita el módulo entero — sin esto, `setupStep()` devuelve `'fields'` y la pantalla de correr no deja importar.

**Único punto de entrada:** un link al pie de la tarjeta «Cómo se ve el archivo» en `/import/ajustes` (`settings-form.tsx:168-173`). No está en el menú, ni en `/import`.

---

## 2. Archivos y ciclo de datos

| Archivo | Líneas | Qué es |
|---|---:|---|
| `apps/web/src/app/(panel)/import/ajustes/columnas/page.tsx` | 25 | Server component. `GET /imports/portfolio/config` |
| `apps/web/src/app/(panel)/import/ajustes/columnas/column-mapper.tsx` | **417** | Toda la pantalla |
| `apps/web/src/app/api/imports/run/route.ts` | 48 | BFF: reenvía el multipart |
| `apps/web/src/lib/import.ts` | 177 | `postImportFile`, `patchConfig`, `pickDaysPastDue`, `confirmDaysPastDue`, `ACCEPTED_FILES` |
| `apps/api/src/modules/imports/field-catalog.ts` | 204 | El catálogo canónico + `normalizeRecord` / `splitName` / `num` |
| `apps/api/src/modules/imports/portfolio-import.service.ts` `readColumns()` | :406 | Lo que responde `?columnsOnly=true` |

**Tres llamadas, y ninguna trae todo:**

```
1. GET  /imports/portfolio/config           → config + catalog  (server component, al entrar)
2. POST /imports/run?columnsOnly=true       → ColumnsPayload    (al subir la muestra, en cliente)
3. PATCH /api/imports/config                → config nueva      (uno por cada cambio)
```

La muestra (`File`) y el `ColumnsPayload` viven **sólo en `useState`** (`:47-51`). El `File` se guarda entero, no su nombre, porque al fijar el ancla del PDF hay que releerlo sin pedirle a la persona que lo busque de nuevo en el disco.

---

## 3. Anatomía — los seis bloques, en orden de pantalla

### 3.1 Archivo de muestra (`:108-138`)
Tarjeta con el nombre del archivo elegido y un botón *Subir / Cambiar la muestra*. El `<input type="file">` está oculto y se dispara desde el botón; el `accept` sale de `ACCEPTED_FILES` (`.csv,.txt,.pdf,.xlsx,.xls`).

Dos detalles pagados con bugs:
- **El input se limpia en cada `change`** (`:123`), si no, reintentar con el MISMO archivo después de un error no dispara nada.
- **Se deduce el MIME de la extensión** cuando el navegador no lo pone (`withDeducedType`): en Windows un `.csv` llega con `type: ''`, el `fileFilter` de la API lo descarta y contesta `FILE_REQUIRED` — «falta el archivo» ante un archivo que la persona acaba de elegir.

### 3.2 Sin muestra → `EmptyState` (`:140-149`)
Todo lo demás desaparece. El único link que se ofrece es *volver a Ajustes*.

### 3.3 Ancla, condicional según la forma configurada
Cada forma trae **su propia pregunta pendiente**, y sólo la suya:

| Forma | Pregunta | Opciones que ofrece |
|---|---|---|
| `rows` | ninguna | — |
| `pdf-rows` | *Cuál fila son los encabezados* (`tableAnchor`) | `headerCandidates` — las primeras filas del archivo, enteras, como preview |
| `pdf-blocks` | *Dónde arranca cada crédito* (`recordStart`) | `recordStartCandidates` — textos repetidos, con **cuántos créditos implica cada uno** |

**Guardar el ancla vuelve a leer la muestra** (`saveAnchor`, `:90-92`). Sin el ancla el motor no encuentra la tabla y devuelve `labels: []`: guardar y no releer dejaba todos los «Sale de» ofreciendo sólo «Sin emparejar» para siempre, sin nada que indicara que había que volver a subir el archivo.

### 3.4 La tabla de emparejado (`:193-293`)
`DataTable` con **orden y paginación apagados** — ordenar navega con `searchParams` nuevos y remontaría la pantalla, perdiendo el archivo de muestra que vive en estado.

| Dato | Sale de | Cómo se trata | |
|---|---|---|---|
| label del catálogo | `<Select>` con las etiquetas del archivo | Obligatorio / Opcional / No importar | **Quitar** |

- **Filas = `Object.entries(config.fields)`** — sólo lo que ya está en la config.
- Los campos `locked` (`code`, `clientName`) muestran «Siempre se importa» y no tienen *Quitar*; su opción «Sin emparejar» se dibuja pero va `disabled`. Desemparejar la llave pasaba las dos validaciones y dejaba la corrida siguiente rechazando el **100 % de las filas** con `NO_CODE` mientras Ajustes se veía entero.
- **La columna guardada se ofrece aunque no esté en esta muestra** (`:238`), si no, cambiar de muestra desemparejaría todo en silencio.
- *Quitar* (`fields: { X: null }`) **saca el campo de la lista**; «No importar» lo deja adentro apagado. Son dos cosas distintas con dos controles distintos.
- Elegir columna limpia `in` (`:222`) para que el motor la busque donde de verdad está.

### 3.5 Agregar un dato (`:295-314`)
Un `<Select>` con los campos del catálogo que **todavía no están** en `config.fields`. Elegir uno lo agrega como `{ enabled: true, required: false }`, sin origen — aparece arriba, en la tabla, sin emparejar.

### 3.6 Cómo viene el nombre (`:316-335`)
`nameOrder`: *Todo junto* / *Dos apellidos y después los nombres* / *Vienen en columnas separadas*.

La vista previa usa un **nombre real del archivo** (`previewName`, espejo exacto del `splitName` de la API — está en `shared` justamente para que las dos pantallas no previean el corte distinto). Con `split-columns` la preview devuelve `—/—` a propósito: esa opción descarta la cadena completa y usa dos columnas emparejadas aparte.

### 3.7 Días de atraso — calibración (`:337-408`)
El paso crítico, y está **último y abajo de todo**.

```
elegir columna  →  ver los valores reales  →  botón «Sí, esos son los días de atraso»
   PATCH #1                                        PATCH #2
```

Son **dos llamadas a propósito**: si elegir confirmara, «confirmado» no significaría nada — nadie habría visto los números. El servidor rechaza el atajo con `CALIBRATION_STALE`.

🔴 En `pdf-blocks` las candidatas salen del **cuadro** del extracto, así que van con `in: 'table'`. Sin eso el motor la busca como etiqueta del encabezado del bloque, no la encuentra, y **toda la cartera entra con cero días de atraso** — nadie aparece en mora y la pantalla igual dice «Confirmada».

---

## 4. El catálogo — 19 campos

Lo manda el servidor (`FIELD_CATALOG`) y viaja en el mismo GET. **Ninguna tabla por banco**: qué campos hay para emparejar lo dice el archivo del cliente.

| Campo | Label | Tipo | ⭐ | 🔒 |
|---|---|---|:-:|:-:|
| `code` | N° de crédito | text | ⭐ | 🔒 |
| `clientName` | Cliente (nombre completo) | text | ⭐ | 🔒 |
| `outstandingBalance` | Saldo | number | ⭐ | |
| `daysPastDue` | Días de retraso | int | ⭐ | |
| `installmentAmount` | Cuota | number | ⭐ | |
| `clientLastName` / `clientFirstName` | Apellidos / Nombres | text | | |
| `coHolder` | Co-titular | text | | |
| `phone` · `address` · `addressRef` | contacto (viven en tablas 1..N) | text | | |
| `status` · `currency` · `branchLabel` | Estado · Moneda · Agencia | text | | |
| `principalAmount` · `interestRate` · `pastDueAmount` | Capital · Tasa · Monto en mora | number | | |
| `disbursedAt` · `nextDueDate` | Desembolso · Próximo vencimiento | date | | |

⭐ = `starred` (se ofrece encendido al configurar por primera vez) · 🔒 = `locked` (no se apaga ni se desmapea).

---

## 5. Reglas del servidor que condicionan la pantalla

`DEFAULT_IMPORT_CONFIG.fields = {}` — **una cuenta nueva, o un reset, deja el emparejado completamente vacío.**

| Código | Cuándo salta |
|---|---|
| `FILE_SHAPE_MISMATCH` | La muestra no tiene la forma configurada. `readColumns` corre `assertFileShape` **antes** de parsear |
| `PARSE_FAILED` | El motor no pudo leer el archivo |
| `COLUMN_ALREADY_MAPPED` | Esa columna ya alimenta otro dato |
| `FIELD_NOT_MAPPED` | Un dato obligatorio quedó sin columna |
| `FIELD_RULE_CONFLICT` | Dos opciones se contradicen |
| `CALIBRATION_STALE` | Se intentó confirmar la mora en el mismo `PATCH` que la elige |
| `PROFILE_CHANGED` | Cambió la forma del archivo → hay que emparejar de nuevo |
| `XLS_LEGACY_NOT_SUPPORTED` | `.xls` viejo |
| `FILE_REQUIRED` | El `fileFilter` descartó el tipo (o el MIME vino vacío) |

Además, en la corrida: `MORA_SIN_CONFIRMAR` y `MORA_COLUMNA_SOSPECHOSA` son **avisos**, no rechazos — se importa igual.

---

## 6. Roces detectados

Ordenados por lo que cuesta al usuario.

| # | Roce | Evidencia |
|---:|---|---|
| 1 | **Arrancando de cero, la pantalla está vacía y la llave está escondida en un dropdown.** `fields` viene `{}`, así que la tabla muestra «Sin emparejar» y los 19 campos —`code` y `clientName` incluidos— caen mezclados en *Agregar un dato*, sin ninguna señal de cuáles son los dos que el import no puede suplir. | `:101`, `:295-314`, `DEFAULT_IMPORT_CONFIG.fields = {}` |
| 2 | **La forma del archivo se elige en la OTRA pantalla, y acá se paga.** Si está mal, subir la muestra devuelve `FILE_SHAPE_MISMATCH` o `labels: []`, y el arreglo está a dos clicks de distancia, atrás. | `assertFileShape` en `readColumns:413` |
| 3 | **La calibración de mora está última.** Es lo que decide quién está en mora y tiene el mismo peso visual que «cómo viene el nombre». | `:337` vs `:316` |
| 4 | **Se empareja a ciegas.** El select ofrece el nombre de la columna; los valores reales sólo se ven en la tarjeta de calibrar. No hay forma de distinguir «SALDO» de «SALDO CAPITAL» sin adivinar. | `:210-244` vs `:382-391` |
| 5 | **El tipo del campo viaja y no se muestra.** Nada impide emparejar una columna de fechas contra `outstandingBalance`; el error aparece recién en la corrida. | `FieldDef.type` sin usar en la web |
| 6 | **`starred` viaja y nadie lo usa.** Los 5 campos esenciales no se distinguen de «Referencia de la dirección». | grep: sólo en `field-catalog.ts` |
| 7 | **Las columnas ya usadas se siguen ofreciendo.** Que una columna alimente dos datos se descubre por `COLUMN_ALREADY_MAPPED` en el banner, no en el select. | `:238` |
| 8 | **La muestra no sobrevive a un refresh** ni a volver desde Ajustes: se vuelve al `EmptyState` y hay que buscar el archivo en el disco otra vez. | `useState<File \| null>` `:51` |
| 9 | **«Quitar» y «No importar» conviven sin explicar la diferencia** — una saca el campo de la lista, la otra lo deja apagado. | `:281` vs `:260` |
| 10 | **No hay estado de conjunto.** Nada dice «14 de 17 emparejados», ni si falta algo obligatorio, ni si la mora quedó sin confirmar. Se sabe al importar. | — |
| 11 | **No se puede probar el emparejado** sin importar de verdad, aunque el `dryRun` ya existe y la firma de `postImportFile` ya lo acepta. | `lib/import.ts:80` |
| 12 | **Un toast «Guardado» por cada cambio.** Emparejar 14 campos son 14 toasts, más los de estado. | `save()` `:65` |
| 13 | **`DataTable` usado como maquetado.** Sin orden, sin paginación, con `meta` inventado (`page:1, limit: max(len,1)`) — se paga un componente pensado para paginación de servidor para dibujar 17 filas fijas. | `:291` |

---

## 7. Lo que el móvil resolvió y acá no

`apps/mobile/app/ajustes/importacion-columnas.tsx` es la misma pantalla, construida antes:

> «La llave y el cliente **se listan SIEMPRE**, estén configurados o no: son los dos que el import no puede suplir, y no verlos en la lista es exactamente cómo se llega a una cartera entera de "SIN NOMBRE" sin que nada haya avisado.»
> «Los bloqueados **no se ofrecen para "agregar"**: ya están arriba, con su aviso si les falta origen.»
> — `importacion-columnas.tsx:175-182`

Esa garantía **no existe en la web** (roce #1). El móvil además muestra el contador de emparejados y un badge ⚠ cuando la mora quedó sin confirmar; la web, ninguno de los dos.

---

## 8. Lo que ya está resuelto y conviene no romper

No son detalles de estilo: cada uno está pagado con un bug.

1. El input de archivo se limpia en cada `change` (reintentar con el mismo archivo).
2. El MIME se deduce de la extensión cuando el navegador no lo pone.
3. Guardar el ancla **relee la muestra**.
4. La columna guardada se ofrece aunque no venga en la muestra de hoy — vale para «Sale de» y para la calibración.
5. Los `locked` no se pueden desemparejar.
6. Elegir la columna de mora **nunca confirma**.
7. En `pdf-blocks` la mora va con `in: 'table'`, explícito y no heredado.
8. El merge de `fields` del servidor **reemplaza la regla entera** → hay que esparcir la anterior o se pierden `enabled`/`required`.
9. `dryRun` es campo del multipart; `columnsOnly` es query. Cruzarlos aplica la importación creyendo que previsualiza.
10. Los selects llevan `aria-label` con el nombre del campo (hay 17 selects iguales por columna).

---

## 9. Preguntas abiertas para el revisor

1. ¿La forma del archivo debería elegirse **acá**, con la muestra ya subida y las etiquetas a la vista, en vez de a ciegas en la pantalla anterior?
2. ¿Se muestran valores de ejemplo por columna en todos los campos, o sólo en la mora? *(Si es en todos: el `ColumnsPayload` hoy sólo trae muestras de las `columnCandidates` numéricas → **es backend**.)*
3. ¿La mora sube al principio, o se queda al final como paso de cierre?
4. ¿La pantalla debería poder correr un `dryRun` de prueba, como el móvil?
5. ¿Se convergen web y móvil a la misma estructura, o cada uno sigue su forma?
6. ¿Se persiste la muestra entre recargas, o se asume que el emparejado se hace de una sentada?
