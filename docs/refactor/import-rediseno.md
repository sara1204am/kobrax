# Configurar la importación — rediseño aplicado

**Fecha:** 25/08/2026 · **Base:** `main` @ `359097c`
**Antes:** [`import-ajustes.md`](./import-ajustes.md) · [`import-columnas.md`](./import-columnas.md)

La configuración dejó de preguntar «¿cómo querés configurar el sistema?» y pasa a preguntar
**«¿dónde está cada dato en tu archivo?»**, mostrando al instante si la respuesta fue correcta.

---

## 1. La decisión estructural: una pantalla, no dos

`/import/ajustes` y `/import/ajustes/columnas` eran dos rutas. Ahora son una: `/import/ajustes`
contiene el recorrido completo y `/import/ajustes/columnas` **redirige** (no se borra: la pantalla
de correr y el texto del error `NO_CODE` mandan textualmente a «Ajustes › Emparejar columnas»).

No fue una preferencia estética. **El archivo de muestra vive en el estado de React y no sobrevive
a un `router.push`**: partido en dos rutas, la forma del archivo se elegía a ciegas en una pantalla
y el error aparecía en la otra, con el archivo ya perdido. Con un solo dueño del estado, el archivo
se sube primero y sigue disponible cuando se cambia la forma, se fija un ancla o se corre la prueba.

El recorrido quedó: **Archivo → Configuración → Revisar → Importar**, con los pasos 3 y 4 en
`/import`. Dentro de «Configuración», cuatro tramos numerados.

---

## 2. Qué ve el usuario, tramo por tramo

| | Antes | Ahora |
|---|---|---|
| **Origen** | `<select>` archivo/manual | Tarjeta con estado y un botón que alterna |
| **1 · Tu archivo** | En la otra pantalla, después | Primero, con el conteo de columnas detectadas |
| **Formato** | `<select>` de 3, elegido a ciegas antes de ver la muestra | **Radio cards** con explicación, junto al archivo — donde el error se descubre |
| **2 · Alcance** | `<select>` + `<select>` | **Radio cards**, y el estado incompleto **se dice** en vez de ser silencio |
| **3 · Columnas** | Otra ruta, link al pie de una tarjeta | Tramo propio, bloqueado con motivo hasta que haya muestra |
| · Mora | Última tarjeta, abajo de todo | **Primera del tramo**, destacada, con tabla Cliente ‖ Días |
| · Campos | `DataTable` de 17 filas | «Datos necesarios» (los ⭐) + «Datos adicionales», con ejemplos reales |
| · Nombre | Tarjeta suelta al final | **Dentro** de la fila de Cliente |
| **4 · Reglas** | Tarjetas sueltas | Radio cards + las dos casillas |
| **Estado** | No existía | Anillo `8/12` + correctos / por revisar / obligatorio pendiente |
| **Resumen** | No existía | Aside pegajoso: archivo, alcance, formato, columnas, mora |
| **Probar** | No existía | `dryRun` real, con vista previa debajo del botón |
| **Guardado** | 10–15 toasts | Una línea: «Guardando…» → «Todos los cambios están guardados» |

---

## 3. Prevención de errores

Tres errores que antes contestaba el servidor, ahora se evitan antes del viaje:

1. **`COLUMN_ALREADY_MAPPED`** — la columna que ya alimenta otro dato sale `disabled` y dice a
   quién alimenta. La llave del check es `dónde:etiqueta`, **igual que el servidor**: bloquear sólo
   por nombre sacaría una combinación que el `PATCH` acepta (el encabezado del bloque y el cuadro).
2. **Cambiar el formato** — borra el emparejado del lado del servidor. Antes era un renglón gris;
   ahora es un modal que dice cuántas columnas se pierden. Si no hay nada emparejado no pregunta:
   preguntar de gusto enseña a decir que sí sin leer.
3. **Alcance incompleto** — elegir «Un oficial» sin elegir a quién no se guarda (el servidor
   rechaza el par). Antes eso era silencio y parecía guardado; ahora lo dice.

---

## 4. Lo único que se tocó del backend (y por qué)

`ColumnsPayload.samples?: Record<string, string[]>` — **valores reales de cada columna**.

`columnCandidates` filtra todo lo que no parece días de atraso (enteros de 1–4 dígitos), así que
para «Cliente» o «Saldo» no había ni un valor y se emparejaba a ciegas entre `SALDO` y
`SALDO CAPITAL`. Se lee con **el mismo `readField` / `row[label]` que usa la corrida**, así que el
ejemplo no puede diferir de lo que después se importa.

`rows.parser.ts` (cubre `rows` **y** `pdf-rows`, ambos entran por `readRows`) ·
`pdf-blocks.parser.ts` · `portfolio-import.service.ts`. Ningún contrato existente cambió: el campo
es opcional y el móvil compila sin tocarlo.

---

## 5. Dónde me aparté del pedido, y por qué

1. **«Probar con 10 registros» → «Probar sin importar».** El `dryRun` procesa el archivo entero;
   decir «10» sería mentir. Se muestran los conteos reales y las primeras 10 filas creadas.
2. **La vista previa no tiene Saldo / Mora / Cuota.** `preview.toCreate` sólo devuelve `code` y
   `clientName`. Dibujar las otras sería inventar datos — el error exacto que esta pantalla evita.
   Ampliar ese endpoint es la vía si se las quiere.
3. **La tarjeta del archivo no dice «10 registros».** `ColumnsPayload` no trae un conteo de
   registros y sacarlo no es gratis: con `fields` vacío, `pdf-blocks` descarta todos los bloques y
   reportaría 0. Se muestra «18 columnas detectadas», que sí es exacto. El conteo real lo da la
   prueba.
4. **El botón de probar quedó en la columna principal, no en el resumen.** El resumen dice si se
   puede probar; el botón vive junto a su resultado, porque apretar a la derecha y que aparezca
   algo a la izquierda, fuera de vista, no es feedback.
5. **Sin descripciones por campo.** Los ejemplos reales explican mejor que una glosa genérica, y
   serían 38 strings (19 campos × 2 idiomas) que se desactualizan con cada campo nuevo.

---

## 6. Las diez reglas que no se tocaron

| | Dónde se protege |
|---|---|
| 1. El `PATCH` es la fuente de verdad | `save()` sólo hace `setConfig(result.config)` |
| 2. Elegir mora ≠ confirmar mora | `pickDaysPastDue` / `confirmDaysPastDue`, dos llamadas |
| 3. `pdf-blocks` necesita `in: 'table'` | explícito en el `onChange` de la mora |
| 4. La columna guardada se ofrece aunque no venga en la muestra | `field-row.tsx` y el select de mora |
| 5. Los `locked` no se desemparejan | opción `disabled`, sin «Quitar», sin estado |
| 6. `dryRun` es campo del multipart | `postImportFile` + **3 tests nuevos** |
| 7. `columnsOnly` es query | idem |
| 8. Guardar el ancla relee la muestra | `saveAndReread()` — y ahora también al cambiar la forma |
| 9. El merge de `fields` no pierde flags | siempre `{ ...rule, … }` |
| 10. Sin cambios de negocio por un problema visual | el único cambio backend es aditivo y opcional |

Y una nueva del mismo tipo: **una prueba corrida se descarta al cambiar cualquier emparejado**.
Dejarla en pantalla diría que una configuración que ya cambió sigue estando bien.

---

## 7. Archivos

```
apps/web/src/app/(panel)/import/ajustes/
├── page.tsx                server component (una sola llamada)
├── import-setup.tsx        la pantalla: estado, guardado, orden, dry run
├── setup-steps.tsx         Step · OptionCards · Switch · SampleStep · ScopeStep · RulesStep · SourceCard
├── columns-step.tsx        mora + datos necesarios + adicionales
├── config-status.tsx       Stepper · SaveIndicator · StatusCard · Summary
├── field-row.tsx           una fila: dato · columna · ejemplos · estado
├── import-setup.test.tsx   12 tests
└── columnas/page.tsx       redirect
apps/web/src/lib/import.ts  fieldStatus · trackedFields · configProgress · usedColumns
```

**Borrados:** `settings-form.tsx`, `columnas/column-mapper.tsx`. `DataTable` ya no se usa acá: se
pagaba un componente de paginación de servidor para dibujar 17 filas fijas, con `meta` inventado.

---

## 8. Verificación

| | |
|---|---|
| `@kobrax/web` type-check · tests · **`next build`** | ✅ · **407/407** · ✅ |
| `@kobrax/api` type-check · tests | ✅ · **728/728** |
| `@kobrax/mobile` type-check · tests | ✅ · **326/326** (sin tocar un archivo) |
| `@kobrax/shared` type-check · tests | ✅ · **78/78** |
| Paridad es/en (`i18n/messages.test.ts`) | ✅ — y el traductor de los tests va contra `es.json` real, así que una clave inexistente rompe |
| Contratos API | sin cambios (el único campo nuevo es opcional) |
| **Validación visual** | ✅ 25/08, por la dueña, con la API y la web levantadas |

Tests nuevos de esta ronda (7): el formato pide confirmación con columnas emparejadas y no molesta
sin ellas · el alcance incompleto no manda nada y lo dice · la prueba no lleva `dryRun` ni
`columnsOnly` en la URL · `postImportFile` manda `dryRun` en el multipart, `columnsOnly` en la
query, y ninguno de los dos en la corrida real.

**Limitaciones reales:**

- Falta `/code-review` y `/ponytail-review`.
- `lint` es un `echo` en este repo: no hay linter real que correr.
- La muestra sigue sin sobrevivir a un refresh de la página. Persistirla exigiría subirla al
  servidor, que es un cambio de alcance mayor.
- El conteo de registros del archivo no se muestra (§5.3).

---

## 9. Barrido de coherencia y código muerto (25/08, después de la validación)

Se buscó, en los cuatro paquetes: exports que nadie importa, archivos que nadie referencia,
dependencias declaradas y no usadas, y claves de i18n huérfanas.

**Lo único de verdad muerto: 18 claves de i18n** (×2 idiomas), casi todas huérfanas de refactors
anteriores, no de este: `portfolio.editSubtitle` y compañía quedaron cuando la ficha pasó a
editarse por secciones; `panel.table.moreFilters` y las otras tres, cuando los filtros se mudaron
al panel lateral. De esta ronda salieron sólo `fieldStates.*.hint` (la fila usa el `label`, nunca
el `hint`).

**Lo que parecía muerto y no lo está** — vale anotarlo para no volver a buscarlo:

| Hallazgo del barrido | Por qué es falso positivo |
|---|---|
| 46 archivos «que nadie importa», casi todos de `shared` | el barril exporta con sufijo `.js` (`export * from './types/import.types.js'`) — un grep por el nombre del archivo no lo ve |
| 191 exports «sin referencia» | tipos consumidos por el barril desde otro paquete, y funciones exportadas que sólo usa su propio archivo (`readBlocks`, `movementColumns`…). Quitarles el `export` es ruido, no limpieza |
| `typescript` sin usar en 3 paquetes | lo usa `tsc`, no un `import` |
| 6 deps de Expo sin usar | autolinking y peers de jest |

**Divergencia real, dejada a propósito:** la web lista siempre los campos `starred` (5) y el móvil
los `locked` (2). No es un descuido — la pantalla del móvil no configura, empareja lo que no se
puede evitar. El comentario de `import.ts` decía «el móvil ya lo resuelve igual», que no era
exacto; ahora dice cuál es la diferencia y por qué.

Tampoco se subió a `shared` el `fieldStatus` / `trackedFields` / `configProgress`: el móvil no los
pide. Son funciones puras sobre `ImportConfig`, así que suben tal cual el día que los pida.
