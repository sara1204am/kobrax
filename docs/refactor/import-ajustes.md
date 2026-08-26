# Ajustes del Import (panel web) — estado para revisión

**Fecha:** 25/08/2026 · **Rama:** `main` @ `359097c`
**Alcance del documento:** describir qué había en la configuración del import del panel web, cómo funcionaba, y dónde se trababa el usuario.

> ⚠️ **Este documento describe el ANTES.** El mismo 25/08 la pantalla se rehízo sobre estos
> hallazgos y absorbió el emparejado de columnas — ver [`import-rediseno.md`](./import-rediseno.md).
> Las §5 «lo que el móvil resolvió», §6 «roces» y §7 «restricciones» siguen siendo la referencia de
> por qué quedó como quedó.

---

## 1. Mapa de archivos

| Archivo | Líneas | Qué es |
|---|---:|---|
| `apps/web/src/app/(panel)/import/ajustes/page.tsx` | 32 | Server component. Trae todo con `GET /imports/portfolio/config` |
| `apps/web/src/app/(panel)/import/ajustes/settings-form.tsx` | 283 | Las 7 decisiones sueltas |
| `apps/web/src/app/(panel)/import/ajustes/columnas/page.tsx` | 25 | Server component (misma llamada) |
| `apps/web/src/app/(panel)/import/ajustes/columnas/column-mapper.tsx` | 417 | Emparejar columnas — **el 80% del trabajo real** |
| `apps/web/src/app/api/imports/config/route.ts` | — | BFF: `PATCH` de config |
| `apps/web/src/app/api/imports/run/route.ts` | — | BFF: subida del archivo (`columnsOnly` / `dryRun`) |
| `apps/web/src/lib/import.ts` | 177 | Llamadas al BFF + texto en un idioma |
| `packages/shared/src/utils/import.ts` | 89 | Reglas puras: `fieldState`, `setupStep`, `previewName`, `soleAssignee` |
| `packages/shared/src/types/import.types.ts` | 157 | `ImportConfig`, `ConfigScreen`, `FieldRule`, `ColumnsPayload` |
| `apps/web/src/messages/{es,en}.json` → `panel.import` | ~180 claves | Todo el texto |

**Referencia obligada:** `apps/mobile/app/ajustes/importacion.tsx` — la misma pantalla en el móvil, construida antes y con mejor resolución de UX (§5).

> Documento hermano: [`import-columnas.md`](./import-columnas.md) — la pantalla de emparejado, donde está el 80% del trabajo.

---

## 2. El contrato de datos

Una sola llamada al abrir cualquiera de las dos pantallas:

```
GET /imports/portfolio/config  →  ConfigScreen
```

```ts
interface ConfigScreen {
  config:   ImportConfig;                 // las 7 decisiones + el emparejado
  catalog:  Record<string, FieldDef>;     // campos disponibles, con label y `locked`
  lastRun:  LastRun | null;               // CONTEOS, no detalle por fila
  members:  ScopeMember[];                // candidatos de scope.ref (personas)
  branches: ScopeBranch[];                // candidatos de scope.ref (sucursales)
}
```

```ts
interface ImportConfig {
  source: 'manual' | 'file';
  profile: { kind: 'rows' | 'pdf-rows' | 'pdf-blocks'; recordStart?; tableAnchor?; headerRow?; signature? };
  fields: Record<string, FieldRule>;      // { enabled?, required?, from?, in?, calibrated? }
  nameOrder: 'full' | 'surnames-first' | 'split-columns';
  scope: { kind: 'official' | 'branch' | 'account'; ref: string | null };
  absentRule: 'set-current' | 'no-touch' | 'ask';
  carriesAssignee: boolean;
  askOnLogin: boolean;
}
```

Las columnas del archivo **no vienen en este GET**: salen de subir una muestra a `POST /imports/run?columnsOnly=true`, que devuelve `ColumnsPayload` (`labels`, `columnCandidates`, y según la forma `recordStartCandidates` o `headerCandidates`). Esa muestra vive sólo en el estado de React.

---

## 3. Pantalla 1 — `/import/ajustes`

**Sin botón de guardar.** Cada control dispara su propio `PATCH` y un toast «Guardado». El servidor valida los invariantes y **la config que vuelve del PATCH es la que manda**, no la que la pantalla creía tener (así es como cambiar la forma del archivo borra el emparejado sin una línea de cliente que lo sepa).

Cinco tarjetas apiladas, todas con `<Select>` nativo:

| # | Tarjeta | Control | Notas |
|---|---|---|---|
| 1 | **De dónde sale la cartera** | `source` | `Se carga a mano` **colapsa todo lo demás** (`settings-form.tsx:93`). El import queda apagado para la empresa. |
| 2 | **Qué cartera trae el archivo** | `scope.kind` + `scope.ref` | `Toda la empresa` guarda al toque; `Un oficial` / `Una agencia` **esperan** a que se elija a quién, porque el par incompleto lo rechaza el servidor con `IMPORT_NOT_CONFIGURED` (`:52`, `:103-106`). Con empresa + un solo miembro activo, avisa que la cartera se autoasigna. |
| 3 | **Cómo se ve el archivo** | `profile.kind` | Tres formas: fila / tabla-en-PDF / bloque. `Hint` gris avisa que cambiarla **borra el emparejado** (`:161`). Al pie de la tarjeta, un link discreto → *Emparejar* (`:168-173`). |
| 4 | **Los créditos que el archivo no trae** | `absentRule` | Ponerlos al día / Dejarlos / Decidir en cada importación. |
| 5 | **Dos casillas** | `carriesAssignee`, `askOnLogin` | La segunda es regla **del móvil**, administrada desde el panel; el subtítulo lo aclara. |

Al final, alineado a la derecha: **Volver a la configuración de fábrica** → modal de confirmación → `PATCH { reset: true }`.

---

## 4. Pantalla 2 — `/import/ajustes/columnas`

Entra sólo por el link de la tarjeta 3. **Sin archivo de muestra no hay nada**: `EmptyState` con un link de vuelta a Ajustes (`column-mapper.tsx:140-149`).

1. **Archivo de muestra** — se sube y la API responde qué etiquetas encontró. El `File` se guarda en estado (no su nombre) porque al fijar el ancla del PDF hay que releerlo.
2. **Ancla, condicional según la forma:**
   - `pdf-blocks` → *Dónde arranca cada crédito* (textos repetidos + cuántos créditos implica cada uno).
   - `pdf-rows` → *Cuál fila son los encabezados* (primeras filas del archivo como preview).
   - `rows` → ninguna pregunta.
   - Guardar el ancla **vuelve a leer la muestra automáticamente** (`saveAnchor`, `:90-92`): sin ancla el motor devuelve `labels: []` y todos los «Sale de» quedarían ofreciendo sólo «Sin emparejar» para siempre.
3. **Tabla de emparejado** (`DataTable`, sin orden ni paginación — ordenar navegaría y perdería la muestra):

   | Dato | Sale de | Cómo se trata | |
   |---|---|---|---|
   | label del catálogo | select con las etiquetas del archivo | Obligatorio / Opcional / No importar | Quitar |

   Los campos `locked` (la llave, `code`) muestran «Siempre se importa» y no se pueden desemparejar ni quitar — desemparejar la llave pasaba las dos validaciones y dejaba la corrida siguiente rechazando el 100 % de las filas con `NO_CODE`.
4. **Agregar un dato** — select con los campos del catálogo que todavía no están en el emparejado.
5. **Cómo viene el nombre** — `nameOrder`, con vista previa calculada sobre un **nombre real** del archivo (`previewName`, espejo del `splitName` de la API).
6. **Días de atraso** — el paso crítico: elegir la columna → ver los valores reales de esa columna → **confirmar en un `PATCH` aparte**. Si elegir confirmara, «confirmado» no significaría nada; el servidor lo rechaza con `CALIBRATION_STALE`.

---

## 5. Lo que el móvil ya resolvió y la web no

`apps/mobile/app/ajustes/importacion.tsx` es la misma configuración, construida antes, y llega bastante más lejos:

| | Móvil | Web |
|---|---|---|
| Estado de configuración | `setupStep()` gatea las filas y **dice por qué** («Elegí el alcance primero») | — |
| Progreso del emparejado | «14 campos emparejados» en el subtítulo de la fila | — |
| Mora sin confirmar | badge **⚠** en la fila de columnas | — |
| Valor actual visible sin abrir | subtítulo de cada `ListRow` | hay que leer el `<Select>` |
| Probar la configuración | botón **«Probar con un archivo»** (usa el `dryRun` que ya existe) | — |
| Última importación | arriba, con `StatTile` + link al detalle | en `/import`, no en Ajustes |
| Controles de 2–3 opciones | `Chips` | `<Select>` |

`setupStep()` vive en `packages/shared` y lo consumen **el móvil (`importacion.tsx:121`) y la pantalla de correr de la web (`import-runner.tsx:62`)** — pero no Ajustes, que es justo donde la persona está tratando de completarlo.

---

## 6. Roces detectados

Ordenados por lo que cuesta al usuario, no por lo que cuesta arreglar.

| # | Roce | Evidencia |
|---:|---|---|
| 1 | **Ajustes nunca dice si el import ya funciona ni qué falta.** El único lugar donde se entera es la pantalla de correr, después de haberse ido. | `setupStep` sin usar en `settings-form.tsx` |
| 2 | **La configuración está partida en dos rutas** y la segunda —donde está casi todo el trabajo— entra por un link al pie de la tarjeta del medio. | `settings-form.tsx:168` |
| 3 | **Cambiar la forma del archivo es destructivo y no pide confirmación**: borra el emparejado entero con sólo un `Hint` gris de aviso. El reset, que borra lo mismo, sí tiene modal. | `:161` vs `:227-249` |
| 4 | **La forma del archivo se elige a ciegas.** Está en la pantalla 1, y que la elección sea la equivocada recién se ve en la pantalla 2, cuando la muestra vuelve sin etiquetas. | flujo `:147` → `columnas` |
| 5 | **La calibración de mora está última y abajo de todo**, con el mismo peso visual que «cómo viene el nombre» — siendo lo que decide quién está en mora. | `column-mapper.tsx:337` |
| 6 | **Se empareja a ciegas.** El select muestra el nombre de la columna, nunca un valor de ejemplo; los valores reales sólo aparecen en calibrar. | `:210-244` vs `:382-391` |
| 7 | **La muestra no sobrevive a un refresh**: vuelve al `EmptyState` y hay que buscar el archivo en el disco otra vez. | `useState<File \| null>` `:51` |
| 8 | **Elegir «Un oficial» deja un estado a medio guardar** sin señal visible: el tipo cambió en pantalla, la config no. | `:52`, `:103-106` |
| 9 | **Siete selects idénticos, cero jerarquía.** «Alcance» (se define una vez) pesa igual que «qué hacer con los ausentes». | toda la pantalla 1 |
| 10 | **Un toast por cada cambio**: configurar de cero son 10–15 «Guardado». | `save()` `:65` |
| 11 | **No hay forma de probar la configuración sin importar de verdad**, aunque el `dryRun` ya existe y el móvil lo usa. | `postImportFile(..., { dryRun })` |

---

## 7. Restricciones que cualquier rediseño tiene que respetar

No son preferencias: cada una está pagada con un bug.

1. **La config que vuelve del `PATCH` es la verdad.** Nunca aplicar el parche en local y asumir.
2. **Elegir la columna de mora y confirmarla son dos llamadas.** El servidor rechaza el atajo (`CALIBRATION_STALE`).
3. **`in: 'table'` en `pdf-blocks` no es cosmético.** Sin eso el motor busca la columna en el encabezado del bloque, no la encuentra, y **toda la cartera entra con cero días de atraso** — nadie aparece en mora y la pantalla igual dice «Confirmada».
4. **La columna guardada puede no venir en la muestra de hoy.** Hay que ofrecerla igual, o cambiar de muestra desempareja todo en silencio.
5. **Los campos `locked` no se desemparejan.** Sin llave, la corrida siguiente rechaza el 100 % de las filas.
6. **`dryRun` va como campo del multipart; `columnsOnly` va como query.** Cruzarlos hace que una corrida se aplique de verdad creyendo que previsualiza.
7. **Guardar el ancla obliga a releer la muestra.**
8. **A `shared` va la regla, nunca el texto en un idioma.** El panel es bilingüe; el móvil no.
9. **Toda ruta privada nueva se suma al matcher de `middleware.ts`.**

---

## 8. Preguntas abiertas para el revisor

1. ¿Una sola pantalla con pasos, o se mantienen las dos rutas y se arreglan los roces?
2. ¿El rediseño alcanza también a `/import` (subir · vista previa · resultado), o sólo a la configuración?
3. ¿Se convergen web y móvil a la misma estructura, o cada uno sigue su forma?
4. Si el diseño pide valores de ejemplo por columna dentro del GET de config, **eso es backend**: ¿entra en el alcance?
5. ¿La pantalla debería poder correr un `dryRun` de prueba, como el móvil?
