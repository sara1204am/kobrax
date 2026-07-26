# F10 · Import — pantalla de Ajustes, contrato de campos y reglas

> Detalle de §9 del plan import (`plans/import/README.md`, settings corta). Es el plan del slice **S1**.
> Responde cuatro preguntas:
> **(1)** cada documento trae columnas distintas → ¿cómo hacen match con la DB;
> **(2)** ¿qué campo se habilita, cuál es obligatorio y cuál no;
> **(3)** ¿qué archivos lee cada plantilla (PDF / Excel / CSV);
> **(4)** ¿qué dibuja exactamente la pantalla y en qué orden aparece cada cosa (§6).
>
> Estado del código al 2026-07-25 (FUNDACION commiteada en `790de8b`, **sin mergear** — R1):
> `importConfig` sólo tiene `source · template · scope · absentRule` (`portfolio-import.service.ts:13`),
> vive en `account.configuration` y **no hay endpoint que lo lea o escriba**. `fields` no existe.
> Todo lo de §3 y §6 es **a construir en S1** (§8.2); §2.1 es un **fix de FUNDACION** (§8.1).

---

## 0. Cambios de esta ronda (2026-07-25) — qué se movió respecto de la ronda 1

Lo pidió la usuaria. Tres tocan decisiones ya cerradas en el README, así que van marcadas:

| # | Cambio | ¿Choca con algo ya cerrado? |
|---|---|---|
| C1 | Arriba de todo, tarjeta **Última importación** (agregados · actualizados · al día). | No. Dato nuevo en el `GET` (§7). |
| C2 | **Origen de datos** es lo primero configurable. Con `Manual` la pantalla queda en una sola línea: *"Agregar créditos a mano"*. Con `Archivo` se despliega el resto. | No. Explicita D-ORIGEN. |
| C3 | Alcance suma **Empresa (todos)** — sirve para el independiente que igual quiere importar; con un solo cobrador se autoasigna a él. Permisos por rol/oficina = futuro. | Amplía §3 del README: `scope.kind` gana `'account'`. |
| C4 | **Reglas** pasa a modal y suma **decidir en cada importación** a la regla de ausentes. **El ausente se pone al día y sigue — no se elimina** (corregido 2026-07-25, ronda 2b). | No. El no-negociable de §4 del README sigue intacto: **el reconcile nunca borra**. |
| C5 | **Emparejar columnas**: pantalla propia con los 4 campos base de cobranza + botón **+** para sumar cualquier campo del catálogo (§2). Flujo: elegís **columna → campo**. | ⚠️ **Choca con §1 de la ronda 1** (*"el móvil no dibuja un mapeador"*). Se resuelve en §1: sí mapea, pero contra catálogo cerrado. |
| C6 | Nombre del cliente: pregunta única **"¿todo es nombre?"** vs **"2 primeras palabras = apellidos"**. Detección automática = implementación siguiente. | No. Hoy el service mete el nombre entero en `firstName` (`portfolio-import.service.ts:134`). |
| C7 | Formato de archivo (**PDF / Excel**) elegible en la pantalla, abajo. | No. Era "Plantilla". Se renombra a lenguaje de usuario. |
| C8 | Toggle **"Preguntar al iniciar sesión"** — si se apaga, el import sólo se entra por el menú. | No. Hace configurable el gate de §6.1 del README (hoy es siempre-sí). |
| C9 | Lectura del documento con IA para proponer el match. | Futuro declarado, no se construye (§10). |
| C10 | **Asistente de primera vez** (§6.9). La misma pantalla, con las secciones bloqueadas hasta contestar la anterior. | No. Cero pantallas nuevas. |
| C11 | **Calibración manual de la columna de mora** (§6.5.1). El usuario confirma cuál columna son los días de atraso, viendo los valores de **su propio archivo**. | **Cierra R1** — ver §6.5.1. Convierte un bloqueante de datos en un campo de configuración. |

---

## 1. Principio: el mapeo es catálogo canónico cerrado + plantilla

El móvil **sí** deja emparejar columnas (C5), pero **el destino nunca es libre**: se elige de la lista
cerrada de §2. Tres capas, cada una en su lugar:

```
Archivo (columnas/etiquetas distintas por banco)
   │
   ├── PLANTILLA (código, un archivo por formato) ──→ nombra las columnas disponibles
   │
   └── importConfig.fields (tenant) ──→ columna → CAMPO CANÓNICO
                                        + enciende/apaga + marca obligatorios
   │
   ▼
Columnas de la DB (`credits` / `clients`) — lista cerrada, §2
```

**Regla dura:** el import sólo puede escribir los campos de §2. Una columna del archivo que el usuario
no empareja con un campo canónico **se descarta** (no va a un JSON basurero). Sumar un banco en PDF
sigue siendo un parser nuevo; sumar un Excel distinto es sólo re-emparejar columnas.

---

## 2. Catálogo canónico — los ÚNICOS campos que el import escribe

Esta tabla es la lista que ofrece el botón **+** de "Emparejar columnas" (§6.5).

| Campo canónico | Etiqueta en la app | Destino en DB | Tipo | ¿Columna NOT NULL? | Default al CREAR si no viene | Al ACTUALIZAR si no viene |
|---|---|---|---|---|---|---|
| `code` 🔑 | N° de crédito | `credits.code` | string | no (pero `@@unique(accountId,code)`) | — **fila inválida** | — (es la llave) |
| `clientName` ⭐ | Cliente | `clients.first_name` / `last_name` (§2.3) | string | no | `'SIN NOMBRE'` | no toca |
| `installmentAmount` ⭐ | Cuota | `credits.metadata.installmentAmount` | number | — | ausente | conserva el previo |
| `daysPastDue` ⭐⚠️ | Días de retraso | `credits.days_past_due` | Int | **sí** (`@default(0)`) | `0` | **no toca** — ver §2.1 |
| `outstandingBalance` ⭐ | Saldo | `credits.outstanding_balance` | Decimal(14,2) | **sí** | `0` | no toca |
| `coHolder` | Co-titular | `credits.metadata.coHolder` | string | — | ausente | conserva el previo |
| `status` | Estado | `credits.status` | enum | **sí** (`@default(ACTIVE)`) | `ACTIVE` | **no toca** (no degrada un `DEFAULTED` a `ACTIVE`) |
| `principalAmount` | Capital | `credits.principal_amount` | Decimal(14,2) | **sí** | `0` | no toca |
| `interestRate` | Tasa de interés | `credits.interest_rate` | Decimal(7,4) | **sí** (`@default(0)`) | `0` | no toca |
| `currency` | Moneda | `credits.currency` | string | **sí** | `'BOB'` | no toca |
| `disbursedAt` | Fecha de desembolso | `credits.disbursed_at` | date | no | `null` | no toca |
| `pastDueAmount` | Monto en mora | `credits.metadata.pastDueAmount` | number | — | ausente | conserva el previo |
| `nextDueDate` | Próximo vencimiento | `credits.metadata.nextDueDate` | ISO date | — | ausente | conserva el previo |
| `branchLabel` | Agencia (cabecera) | **no se escribe** | string | — | — | valida el alcance (§5) |
| `assignee` | Cobrador asignado | `credits.assigned_manager_id` | uuid | no | del alcance / reparto (§2.4) | sólo si `carriesAssignee` |

🔑 `code` es la llave de match (D-KEY) — **no se configura, no se apaga, no se puede cambiar**.
⭐ = los cinco que vienen **encendidos por defecto** al configurar por primera vez (§6.5). El resto
entra por el botón **+**.

> El pedido literal fue *"cuota, días de retraso, usuario y crédito"*. Sumé **Saldo** al set por
> defecto: sin él la ficha del crédito arranca en 0 y la lista de cartera muestra deuda cero, que es
> peor que no importar. Si preferís que quede en el **+**, es una línea (§8.2, item 1).

### 2.1 `daysPastDue` — la excepción que hoy está mal

`credits.days_past_due` es `Int NOT NULL @default(0)` y el parser devuelve `0` cuando la columna
está vacía. Hoy el service hace `daysPastDue: b.daysPastDue` **siempre** → si mañana una plantilla
no produce mora, **una importación pone toda la cartera en 0 días**. Silencioso y destructivo.

**Regla:** `daysPastDue` (y todo campo numérico) distingue **ausente (`null`) de cero (`0`)**.
El parser devuelve `null` si la columna no existe o no se pudo leer; `0` sólo si leyó un cero.
`null` en un update ⇒ **no se escribe la columna**. Mismo criterio para `outstandingBalance`.

### 2.2 Lo que el import NUNCA toca

`nationalId` · `taxId` · teléfonos y direcciones (`client_contacts` / `client_locations`) ·
GPS · `credit_installments` (cronograma) · `payments` · `agenda_items` · **`deletedAt`** (§4 del README:
**el reconcile no borra**, y §5.2 lo confirma) · cualquier crédito con `metadata.origin ≠ 'import'`.

### 2.3 Nombre del cliente — la pregunta que se hace una sola vez (C6)

El extracto trae `MARTINEZ DURAN JUAN ANTONIO` sin delimitar dónde termina el apellido. Hoy el service
lo mete entero en `firstName` (`portfolio-import.service.ts:134`). Se le pregunta al usuario **una vez**,
al emparejar la columna Cliente:

| Opción | `nameOrder` | Qué hace | Ejemplo |
|---|---|---|---|
| **Todo junto** (default) | `'full'` | `firstName` = la cadena entera, `lastName` = `null` | `firstName: 'MARTINEZ DURAN JUAN ANTONIO'` |
| **Apellidos primero** | `'surnames-first'` | 2 primeras palabras → `lastName`; el resto → `firstName` | `lastName: 'MARTINEZ DURAN'`, `firstName: 'JUAN ANTONIO'` |

Reglas del split (deterministas, sin heurística — la heurística es la implementación siguiente):
- Menos de 3 palabras → se ignora la opción y entra como **Todo junto** (no adivina).
- Partículas (`DE`, `DEL`, `LA`, `LOS`) se pegan a la palabra siguiente y **no** cuentan como palabra.
- Se guarda tal cual: el import **no** normaliza mayúsculas ni acentos (`trim` y nada más).

Se pregunta sólo la primera vez que se empareja `clientName`; después queda como un renglón editable
en la pantalla de emparejado. **Detección automática de apellido/nombre = implementación siguiente**,
no entra en S1 (C9).

### 2.4 Alcance `Empresa (todos)` y autoasignación (C3)

`scope.kind: 'account'` = el archivo cubre **toda la cuenta**; el reconcile no filtra por
`branchId` ni por `assignedManagerId`. Es el caso del cobrador independiente y de la empresa chica
con una sola lista.

Con `carriesAssignee: false` y `scope.kind: 'account'`:

| Cuántos usuarios activos con capacidad de cobrar tiene la cuenta | Qué pasa |
|---|---|
| **1** | `assignedManagerId` = ese usuario, automático. **No sale el paso de reparto.** |
| **2 o más** | Sale el paso de reparto (S5), como hoy con agencia/sucursal. |

> **Permisos por rol y oficina quedan fuera** (decisión de la usuaria): hoy quien tiene
> `CLIENT_IMPORT` importa toda la cuenta. Se revisa cuando aterricen roles/oficinas (F3/P10 · R4).
> Anotado también en §10.

---

## 3. `importConfig` — forma completa

Vive en `account.configuration.importConfig` (JSONB, sin tabla nueva). **Sólo se guardan las
desviaciones**: un campo ausente de `fields` usa el default de la plantilla (§4).

```jsonc
{
  "source": "file",                          // 'manual' apaga el módulo entero (§6.2)
  "template": "banco-union-pdf",             // §4  — en la UI se llama "Formato del archivo"
  "scope": { "kind": "account", "ref": null },   // 'official' | 'branch' | 'account' (§2.4)
  "absentRule": "set-current",               // 'set-current' | 'no-touch' | 'ask' (§5.2) — nunca borra
  "carriesAssignee": false,                  // false ⇒ sale el paso de reparto (salvo §2.4)
  "askOnLogin": true,                        // C8 — false ⇒ sólo se entra por el menú
  "nameOrder": "full",                       // §2.3
  "fields": {
    "daysPastDue":        { "enabled": true,  "required": true, "column": "Mora", "calibrated": true },
    "outstandingBalance": { "enabled": true,  "required": true  },
    "installmentAmount":  { "enabled": true,  "required": true, "column": "Cuota" },
    "principalAmount":    { "enabled": false },
    "interestRate":       { "enabled": false }
  },
  "statusMap": { "VIGENTE": "ACTIVE", "VENCIDO": "DEFAULTED" }   // se edita en web
}
```

### 3.1 Semántica exacta de los flags

| Flag | Qué significa | Efecto |
|---|---|---|
| `enabled: false` | *"lo que diga el archivo de este campo, ignoralo"* | El campo **no se escribe nunca**. Al crear se usa el default de §2; al actualizar, el valor de la DB queda **intacto**. No genera fila inválida aunque falte. |
| `required: true` | *"sin este dato la fila no sirve"* | Si el valor llega `null`/vacío → la fila va a `invalid[]` con `MISSING_<CAMPO>` y **no se importa** (ni crea ni actualiza). Cuenta en el balde de advertencias de la Vista Previa. |
| `required: false` | opcional | El valor se escribe si viene; si no viene, §2 (default al crear / no tocar al actualizar). |
| `column: "..."` | nombre del encabezado en el archivo | **En `csv`/`xlsx`: siempre editable.** En `banco-union-pdf` se ignora — las etiquetas están fijas en el parser — y la UI lo muestra en gris. **Excepción: `daysPastDue`**, que es editable también en PDF (§6.5.1): es el único campo cuya columna el parser no puede determinar solo. |
| `calibrated: true` | *"el usuario miró los valores y confirmó que esta columna es la correcta"* | **Sólo `daysPastDue`** (§6.5.1). En `false` (default en cuenta nueva) el import **corre igual**, pero la Vista Previa muestra el aviso *"Días de atraso sin confirmar"* con acceso a la pantalla. No es un bloqueo: es una deuda visible. Cambiar `column` lo vuelve a poner en `false`. |

**Invariantes (se validan en el `PATCH`, no sólo en la UI):**

1. `enabled: false` + `required: true` → **400 `FIELD_RULE_CONFLICT`**. Es contradictorio.
2. Sólo se puede marcar `required` un campo que **la plantilla produce** (§4). Marcar `installmentAmount`
   obligatorio con `banco-union-pdf` → **400 `FIELD_NOT_IN_TEMPLATE`**: reventaría el 100 % de las filas.
3. `code` y `clientName` no se pueden apagar: `code` es la llave; sin `clientName` no hay a quién cobrar.
4. Cambiar `template` **resetea `fields`** a los defaults de la nueva plantilla (los nombres de columna
   de un formato no significan nada en otro).
5. **Una columna no se puede emparejar con dos campos** → 400 `COLUMN_ALREADY_MAPPED` (C5). Al revés sí
   da igual: un campo tiene una sola columna por definición.
6. `scope.kind: 'account'` ⇒ `scope.ref` debe ser `null`; `'official'`/`'branch'` ⇒ `ref` obligatorio
   → 400 `IMPORT_NOT_CONFIGURED` (§5).
7. `calibrated` sólo se acepta en `daysPastDue`; en cualquier otro campo → 400 `FIELD_RULE_CONFLICT`.
   Y el `PATCH` **no puede subirlo a `true` en la misma llamada que cambia `column`**: confirmar es un
   acto aparte de elegir, si no el "confirmado" no significa nada.

### 3.2 Ejemplo del caso planteado

> *"puede que sea obligado cuota, mora y días, pero no el capital ni la tasa de interés"*

```jsonc
"fields": {
  "installmentAmount":  { "enabled": true,  "required": true  },   // cuota
  "pastDueAmount":      { "enabled": true,  "required": true  },   // monto en mora
  "daysPastDue":        { "enabled": true,  "required": true  },   // días de mora
  "principalAmount":    { "enabled": false },                      // capital: ni se mira
  "interestRate":       { "enabled": false }                       // tasa: ni se mira
}
```
Lectura: una fila sin cuota, sin monto de mora o sin días → **advertencia, no se importa**.
El capital y la tasa que traiga el archivo se **ignoran**; el valor que ya tiene el crédito en la DB
no se pisa (y al crear, quedan en `0`).

---

## 4. Plantillas — qué archivo lee cada una y qué campos produce

En la app se llama **"Formato del archivo"** (C7). "Plantilla" es la palabra del código.

| Plantilla | `template` | Etiqueta en la app | Extensiones | MIME aceptado | Detección | Estado |
|---|---|---|---|---|---|---|
| Extracto Banco Unión | `banco-union-pdf` | **PDF · Extracto Banco Unión** | `.pdf` | `application/pdf` | texto contiene `REPORTE DE EXTRACTO DE PRESTAMOS` **y** `PRR0785A` | ✅ construida |
| Excel genérico | `xlsx` | **Excel (.xlsx / .xls)** | `.xlsx`, `.xls` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel` | 1ª hoja, 1ª fila = encabezados | ⬜ pendiente (dep `xlsx` aprobada, **no instalada**) |
| CSV genérico | `csv` | **CSV (.csv)** | `.csv` | `text/csv`, `text/plain` | 1ª fila = encabezados | ⬜ pendiente (reusa `clients/import/csv.ts`) |

**Reglas de archivo (las tres capas, las tres obligatorias):**
1. **Picker del móvil** filtra por las extensiones de la plantilla activa (`expo-document-picker`).
2. **Multer** en la API: `fileFilter` por MIME **de la plantilla configurada** + tope **15 MB** (N6).
   Hoy está fijo en `application/pdf` → pasa a depender de `template`.
3. **El parser verifica su firma.** PDF que no es Banco Unión → `NOT_BANCO_UNION_TEMPLATE` → 400.
   Renombrar un `.xlsx` a `.pdf` no engaña a nadie.

### 4.1 Campos que produce cada plantilla (defaults de `fields`)

`—` = la plantilla no lo trae ⇒ **no se puede habilitar ni marcar obligatorio** (invariante 2).
En `csv`/`xlsx` "produce" = *hay columnas para emparejar*; cuál, lo decide el usuario en §6.5.

| Campo | `banco-union-pdf` | `csv` / `xlsx` |
|---|---|---|
| `code` | ✅ `No.Credito` (**req**) | ✅ columna mapeada (**req**) |
| `clientName` | ✅ `Cliente` (req) | ✅ (req) |
| `installmentAmount` | — | ⚪ default ON |
| `daysPastDue` | ✅ col. `Dias Mora` (default) — **columna elegible por el usuario, §6.5.1** | ⚪ default ON |
| `outstandingBalance` | ✅ `Saldo Credito` (req) | ⚪ default ON |
| `coHolder` | ✅ 2ª línea de `Cliente` | ⚪ vía **+** |
| `status` | ✅ `Estado` | ⚪ vía **+** |
| `principalAmount` | ✅ `Monto` | ⚪ vía **+** |
| `interestRate` | ✅ `Tasa Interes` | ⚪ vía **+** |
| `currency` | ✅ `Moneda` | ⚪ vía **+** |
| `disbursedAt` | ✅ `Fecha Desembolso` | ⚪ vía **+** |
| `pastDueAmount` | ✅ `Moratorios` (lo extrae F7 — §8.1) | ⚪ vía **+** |
| `nextDueDate` | — (`Fec.Vencimiento` va a metadata, sin normalizar) | ⚪ vía **+** |
| `branchLabel` | ✅ cabecera `MICROCREDITO AGENCIA <X>` | ⚪ vía **+** |
| `assignee` | — | ⚪ vía **+** (habilita `carriesAssignee`) |

> ✅ **R1 se cierra por calibración manual, no esperando un PDF** (C11). El único extracto de muestra
> está VIGENTE con mora 0 y `Dias Int.` cae contigua a `Dias Mora`, así que ningún test automático
> puede distinguirlas con los archivos que hay — **y no se pueden fabricar: el extracto lo emite el
> banco, nosotros sólo lo leemos**. La columna pasa a ser elegible por el usuario contra los valores
> de su propio archivo (§6.5.1).

### 4.2 Normalización de valores (igual para toda plantilla)

| Qué | Regla |
|---|---|
| Números | coma = miles, punto = decimal (`859,743.98`). Paréntesis = negativo (`( 4,767.67)` → `-4767.67`). `%` se descarta. No parseable → `null` (≠ 0). |
| Fechas | `dd/mm/yyyy` → ISO `yyyy-mm-dd`, sin `Date` (evita corrimiento de TZ). Formato distinto → `null`. |
| Moneda | `BOLIVIANOS→BOB`, `DOLARES→USD`. Desconocida → se guarda cruda y la fila va a `invalid` si `currency` es `required`. |
| Estado | `statusMap` del tenant; sin match → **no se escribe** (update) / `ACTIVE` (create). Nunca degrada. |
| Texto | `trim`. Vacío = ausente (`null`), no cadena vacía. |
| Nombre | §2.3 según `nameOrder`. |

---

## 5. Orden de validación y códigos de error

**Por archivo** (falla ⇒ no se importa nada):

| Código | Cuándo |
|---|---|
| `IMPORT_DISABLED` | `source = 'manual'` |
| `IMPORT_NOT_CONFIGURED` | falta `scope.ref` con `kind` official/branch (§3.1 inv. 6) |
| `FILE_TOO_LARGE` | > 15 MB |
| `BAD_MIME` | extensión/MIME fuera de la plantilla |
| `PARSE_FAILED` / `NOT_<PLANTILLA>_TEMPLATE` | firma no coincide o PDF corrupto |
| `SCOPE_MISMATCH` | el `branchLabel` de la cabecera ≠ `scope.ref` **(a construir — hoy no se valida)**. No aplica con `kind: 'account'`. |
| `COLUMN_NOT_FOUND` | una columna emparejada en `fields` no existe en el encabezado del archivo (csv/xlsx). **Nuevo (C5)**: sin esto, un Excel con la columna renombrada importa medio vacío sin avisar. |
| `EMPTY_FILE` | 0 bloques/filas parseados |

**Por fila** (van a `invalid[]`, el resto del archivo sigue):

| Código | Cuándo |
|---|---|
| `NO_CODE` | fila sin `No.Credito` |
| `DUP_IN_FILE` | el mismo `code` dos veces en el archivo |
| `MISSING_<CAMPO>` | campo `required` sin valor |
| `MATCHES_MANUAL` | el `code` choca con un crédito cargado a mano → intocable |
| `MATCHES_OUT_OF_SCOPE` | el `code` existe fuera del alcance o borrado → ni update ni create |

Las filas inválidas **se muestran en la Vista Previa antes de confirmar** (pantalla "con advertencias").
Nunca se importan a medias: o la fila entra completa, o no entra.

**Advertencias que NO rechazan** (la fila se importa igual; van en `warnings[]`, no en `invalid[]`):

| Código | Cuándo | Cómo se ve |
|---|---|---|
| `MORA_INCONSISTENTE` | el crédito viene `VIGENTE` con `Moratorios = 0` pero la columna de días de atraso da `> 0` | Marca en la fila de la Vista Previa. **Si supera el 20 % de las filas**, banner arriba: *"Puede que la columna de días de atraso esté mal elegida"* + acceso directo a §6.5.1. |
| `MORA_SIN_CONFIRMAR` | `fields.daysPastDue.calibrated = false` | Aviso de una línea en la Vista Previa, una vez por corrida. No cuenta filas. |

La distinción es deliberada: una fila que no se puede escribir bien **se frena** (`invalid`), una fila
que se puede escribir pero **huele mal se importa y se avisa**. Frenar por sospecha convertiría un
layout raro del banco en una cartera que no entra nunca.

### 5.1 Alcance = filtro del reconcile

| `scope.kind` | Universo del reconcile | Etiqueta en la app |
|---|---|---|
| `official` | `assignedManagerId = scope.ref` | Oficial de crédito |
| `branch` | `branchId = scope.ref` | Agencia o sucursal |
| `account` | **toda la cuenta** (sin filtro) | Empresa (todos) |

El matching de colisión sigue leyendo **toda la cuenta** en los tres casos (el `@@unique(accountId,code)`
es account-wide; ver comentario en `portfolio-plan.ts:30`). Lo que cambia es el flag `eligible`.

### 5.2 Regla de ausentes — las tres opciones (C4)

*Ausente* = crédito con `origin='import'`, dentro del alcance, que **no** aparece en el archivo.

| Opción (etiqueta) | `absentRule` | Qué hace | Default |
|---|---|---|---|
| **Ponerlos al día** | `set-current` | `daysPastDue = 0`, `status = ACTIVE`. **El saldo NO se toca** (pagó la cuota, no el crédito) y **el crédito sigue vivo en la cartera**. | ✅ |
| **Dejarlos como están** | `no-touch` | Nada. El crédito conserva su mora. | |
| **Decidir en cada importación** | `ask` | No decide acá: la Vista Previa lista los ausentes y el usuario elige **por crédito** (al día / dejar como está) antes de confirmar. | |

> **No hay opción de eliminar** (decisión de la usuaria, 2026-07-25): si un crédito no viene en el
> archivo es porque **está al día**, no porque dejó de existir. Se pone al día y sigue.
> El no-negociable del README §4 (*"el reconcile NUNCA borra ni desactiva"*) queda **intacto**:
> `deletedAt` sigue en la lista de §2.2 de lo que el import no toca, la Vista Previa sigue con
> **tres baldes** y *Eliminados = 0, siempre*.

`ask` es la opción segura para el que no está seguro: no cambia nada hasta que mira la lista.
Sus dos acciones por crédito son las mismas de arriba — no aparece ninguna tercera.

---

## 6. La pantalla de Ajustes → Importación

Un solo screen (`app/ajustes/importacion.tsx`) + dos modales + un screen de emparejado.
Todo con componentes que ya existen (`Header`, `SectionLabel`, `Chips`, `ListRow`, `StatTile`,
`BottomSheet`, `EmptyState`) — **cero componentes nuevos**.

### 6.1 Layout completo (origen = Archivo)

```
‹  Importación
─────────────────────────────────────────────
  ÚLTIMA IMPORTACIÓN                              ← §6.3
  Hoy 08:14 · Extracto Banco Unión · Agencia Sucre
  ┌──────────┬──────────────┬──────────┐
  │    12    │     340      │    28    │
  │ Agregados│ Actualizados │  Al día  │
  └──────────┴──────────────┴──────────┘
  Ver detalle                              ›
─────────────────────────────────────────────
  ORIGEN DE DATOS                                 ← §6.2
  ( Manual │ ARCHIVO )
─────────────────────────────────────────────
  ALCANCE DEL ARCHIVO                             ← §6.4 · sólo si Archivo
  ( Oficial │ Agencia o sucursal │ EMPRESA (TODOS) )
  Se asigna a Sara Acha                    (sólo si Empresa + 1 cobrador)

  Formato del archivo    PDF · Extracto Banco Unión  ›   ← §4 · BottomSheet
  ¿El archivo trae el cobrador?                  [OFF]

  Reglas                 Ausentes: ponerlos al día   ›   ← §6.6 · modal
  Emparejar columnas     5 campos emparejados        ›   ← §6.5 · screen
  Llave de match         N° de crédito                   ← ListRow sin onPress
─────────────────────────────────────────────
  Preguntar al iniciar sesión                    [ON]    ← §6.7
  Si lo apagás, entrás por Más › Importar datos.

  [  Probar con un archivo  ]                            ← §6.8 (propuesta)
```

### 6.2 Origen de datos — el interruptor de todo (C2)

Chips de dos estados. **Con `Manual` la pantalla se colapsa** a:

```
‹  Importación
─────────────────────────────────────────────
  ORIGEN DE DATOS
  ( MANUAL │ Archivo )
  Los créditos se cargan uno por uno. No se lee ningún archivo.

  Agregar crédito a mano                    ›   → /credito/nuevo
```

Nada más. Ni alcance, ni formato, ni reglas, ni emparejado: si no hay archivo, esas preguntas no
existen. La tarjeta de última importación **sí** se mantiene si alguna vez importó (histórico), con
la nota *"Origen cambiado a manual"*.

Cambiar de `Archivo` → `Manual` **no borra** la configuración guardada: si vuelve a `Archivo`,
encuentra todo como lo dejó. (Guardar la config no cuesta nada; re-configurar sí.)

### 6.3 Última importación (C1)

Tres `StatTile` con los contadores que **ya se guardan** en `client_import_runs`
(`creditsCreated` / `creditsUpdated` / `creditsSetCurrent`) + `errors`. Tres y sólo tres: no hay
balde de eliminados (§5.2).

**La línea de arriba sale toda de columnas que ya existen**: `createdAt` (fecha) + `template`
(plantilla) + `scope` (alcance). **No dice el nombre del archivo a propósito:**
`client_import_runs` guarda `fileHash`, no `fileName` (verificado en `schema.prisma`), y agregar una
columna + migración para una etiqueta no se paga. Plantilla + alcance + hora distinguen igual dos
corridas del mismo día. Si algún día hacen falta varios archivos con la misma plantilla y alcance en
el mismo día, ahí se agrega `fileName String?` — no antes.

- Sin corridas → `EmptyState` corto: *"Todavía no importaste ningún archivo."*
- Con errores → el conteo en rojo debajo: *"3 filas con problemas"*, tap → detalle de la corrida.
- Es **sólo lectura**. Poner esto arriba es lo que contesta la pregunta real del usuario al entrar
  ("¿anduvo lo de hoy?") sin tener que leer la configuración.

### 6.4 Alcance del archivo (C3)

Chips de tres: `Oficial` · `Agencia o sucursal` · `Empresa (todos)`.

| Elección | Qué pide después | Subtítulo |
|---|---|---|
| Oficial | selector de usuario (BottomSheet) | *"El archivo trae la cartera de un solo oficial."* |
| Agencia o sucursal | selector de sucursal (BottomSheet) | *"El archivo trae la cartera de una agencia. Sólo se reconcilia esa agencia."* |
| Empresa (todos) | nada | *"El archivo trae toda la cartera de la empresa."* + si hay un solo cobrador: *"Se asigna a `<nombre>`."* (§2.4) |

### 6.5 Emparejar columnas — screen propia (C5)

Se entra desde `ListRow`. Título: **Emparejar columnas**. Sirve para PDF y para Excel/CSV, con una
diferencia: **con PDF las columnas vienen fijas del parser y se muestran en gris**; con Excel/CSV se
eligen. **Excepción: `Días de retraso` es elegible siempre** — ver §6.5.1.

```
‹  Emparejar columnas
─────────────────────────────────────────────
  Llave: N° de crédito ← "No.Credito"
  No se puede cambiar: es lo que identifica a cada crédito.
─────────────────────────────────────────────
  CAMPOS EMPAREJADOS
  Cliente             "Nombre"          Obligatorio  ›
      Todo junto (no separa apellidos)                    ← §2.3
  Cuota               "Cuota"           Obligatorio  ›
  Días de retraso     "Dias Mora"       Obligatorio  ›
      ⚠ Sin confirmar — revisá los valores                ← §6.5.1
  Saldo               "Saldo"           Opcional     ›
─────────────────────────────────────────────
  [ + Agregar campo del archivo ]
```

**Flujo del botón `+` — columna primero, campo después** (es el orden que pidió la usuaria y el que
tiene sentido: el usuario está mirando su archivo, no la DB):

1. BottomSheet **"¿Qué columna del archivo?"** → lista de encabezados detectados. En Excel/CSV salen
   del archivo de muestra; en PDF, las etiquetas fijas del parser (§4.1). Las ya emparejadas salen
   deshabilitadas (invariante 5).
2. BottomSheet **"¿A qué corresponde?"** → catálogo de §2, con las etiquetas en español y los ya
   emparejados fuera de la lista.
3. Queda como fila nueva, en **Opcional**.

**Cada fila** abre un BottomSheet con **un solo control de tres estados** (no dos toggles):

| Estado | `fields` | Subtítulo = la consecuencia, no la definición |
|---|---|---|
| **Obligatorio** | `enabled:true, required:true` | *"Si el archivo no lo trae, ese crédito no se importa."* |
| **Opcional** | `enabled:true, required:false` | *"Si no viene, se deja como está."* |
| **No importar** | `enabled:false` | *"Se ignora lo que diga el archivo."* (+ acción **Quitar del emparejado**) |

Esto elimina de raíz el estado contradictorio del invariante 1.

**Para leer los encabezados de un Excel hace falta un archivo.** Sin él no hay nada que emparejar,
así que la primera vez la pantalla arranca con `EmptyState` + `[ Elegir un archivo de muestra ]`
(mismo `expo-document-picker`, `dryRun` que devuelve sólo los encabezados). Con PDF no aplica: las
etiquetas ya las sabe el parser.

> Sólo se listan los campos que la plantilla produce (§4.1). Cambiar de formato redibuja la lista y
> resetea a sus defaults, con confirmación: *"Se van a restablecer las reglas de campos."* (invariante 4).

### 6.5.1 Calibración de los días de retraso — cierra R1 (C11)

**El problema, en una línea:** en el extracto del Banco Unión, `Dias Int.` y `Dias Mora` caen
contiguas, y con el único archivo disponible (VIGENTE, `Moratorios = 0`) **ningún test automático
puede distinguirlas** — si el parser leyera la columna equivocada, el resultado sería el mismo `0`.

**Por qué no se resuelve esperando un PDF mejor:** el extracto lo emite el banco y nosotros sólo lo
leemos. No podemos fabricar uno con mora, ni pedir que nos manden el caso que necesitamos para el
test. Un bloqueante que depende de que aparezca un archivo es un bloqueante permanente.

**La salida: preguntarle al que sí sabe.** El usuario conoce su cartera. Si le mostramos el número
que saldría de cada columna **de su propio archivo**, junto al cliente, puede decir en 5 segundos
cuál es la buena — algo que ningún test puede hacer.

```
  Días de retraso
  ─────────────────────────────────────
  ¿Cuál de estas columnas son los días
  de atraso? Mirá los números y elegí.

  ○ Dias Int.
      PEREZ QUISPE MARIO      18
      MAMANI CHOQUE ROSA      31
      VARGAS LEON JULIO       30

  ● Dias Mora                     (sugerida)
      PEREZ QUISPE MARIO       0
      MAMANI CHOQUE ROSA       0
      VARGAS LEON JULIO        0
  ─────────────────────────────────────
  Si ninguna coincide con lo que sabés de
  estos clientes, no importes todavía.
```

| | |
|---|---|
| **Dónde** | Fila `Días de retraso` de §6.5. Es el mismo BottomSheet de elegir columna, sólo que además **muestra 3 valores reales** por candidata. |
| **Candidatas** | Las columnas numéricas del cuadro de movimientos que el parser detecta por su encabezado. En Excel/CSV, las columnas numéricas del archivo. |
| **Cómo llegan** | El dry-run devuelve `columnCandidates: { header, samples: { clientName, value }[] }[]` (F5 · §8.2 items 5b y 7) — **para toda plantilla, PDF incluido**. El móvil no parsea nada (D-PARSER): sube el archivo y dibuja lo que le mandan. Cada muestra lleva el nombre del cliente de su fila: sin eso el número no tiene contra qué compararse. |
| **Default** | `Dias Mora` marcada como *sugerida* — la heurística actual (`banco-union.parser.ts:163`) sigue siendo la apuesta, sólo que ahora es una **sugerencia revisable** y no un acto de fe. |
| **Estado** | `fields.daysPastDue.calibrated: boolean`. Arranca en `false` → la fila muestra **⚠ Sin confirmar** y la Vista Previa avisa antes de cada import. Confirmar la deja en `true` y el aviso desaparece. |
| **Se guarda en** | `fields.daysPastDue.column` — el campo que §3 **ya define**. En PDF deja de ignorarse **sólo para este campo**; el resto sigue en gris. |

**Guarda automática, además de la manual** (la que ya describía el README §5, ahora con dónde se ve):
si en un mismo crédito `Moratorios = 0` y `status = VIGENTE` pero la columna elegida da `> 0`, la fila
sale en la Vista Previa con `MORA_INCONSISTENTE` — **advertencia, no rechazo** (puede ser legítimo);
está en la tercera tabla de §5, la de advertencias que no frenan la fila. Si pasa en **más del 20 %
de las filas**, el banner de la preview lo dice fuerte: *"Puede que la columna de días de atraso esté
mal elegida"*, con acceso directo a esta pantalla.

> La guarda necesita `Moratorios`, que el parser **hoy no extrae** (§4.1). Lo agrega **F7** (§8.1):
> es una etiqueta más sobre la maquinaria que F5 ya monta, y de paso llena `pastDueAmount`.

Las dos capas se cubren mutuamente: el usuario atrapa la columna corrida el primer día; la guarda
atrapa el caso en que el banco cambie el layout dentro de seis meses y nadie mire la configuración.

> Con esto, `banco-union.calibration.spec.ts:37` (`it.todo('daysPastDue > 0 contra un extracto con
> mora real')`) **se reemplaza** por tests que sí se pueden correr hoy: que `extractDaysPastDue`
> respeta la columna configurada, que el default sigue siendo `Dias Mora`, y que la guarda de
> inconsistencia dispara. **FUNDACION deja de estar bloqueada para `main`.**

### 6.6 Reglas — modal (C4)

`ListRow` cuyo valor es la regla activa. Abre `BottomSheet` con las tres opciones de §5.2,
encabezado explicando el caso:

```
  Reglas de importación
  ─────────────────────────────────────
  Los créditos que YA tenés y que NO vienen
  en el archivo, ¿qué hacen?

  ● Ponerlos al día
    Quedan vigentes, sin días de retraso. El saldo no se
    toca y el crédito sigue en tu cartera.
  ○ Dejarlos como están
    No se modifican.
  ○ Decidir en cada importación
    Te muestro la lista antes de confirmar y elegís.
  ─────────────────────────────────────
  Ningún crédito se elimina al importar. Los cargados a
  mano y los de fuera del alcance no se tocan nunca.
```

### 6.7 Preguntar al iniciar sesión (C8)

Switch. `true` (default) = el gate post-login del README §6.1 sigue como está. `false` = el gate no
corre y el import se entra sólo por `Más › Importar datos`. Se guarda en `importConfig.askOnLogin`
(config del tenant, no flag local: es una decisión de cómo trabaja la oficina, no del dispositivo).

La condición del gate queda:
`capacidad CLIENT_IMPORT && source === 'file' && askOnLogin && !yaImportóHoy && !saltóHoy`.

### 6.8 Guardado y errores

- Guarda al toque (`PATCH /api/imports/portfolio/config`). Sin botón "Guardar".
- Si el backend rechaza por invariante → `ErrorBanner` (`src/components.tsx:86`, ya existe) arriba con
  el mensaje del código y el control **vuelve al valor previo**. Nada de estado optimista que miente.
- **Sin conexión, esta pantalla no se puede usar** — y está bien: no es una acción de campo. Se muestra
  el `OfflineIndicator` que ya existe y los controles quedan `disabled`. El no-negociable de
  offline-first protege **la gestión del cobrador**, no la configuración de la oficina: guardar
  reglas en local y sincronizarlas después abriría la puerta a dos dispositivos con reglas distintas
  reconciliando la misma cartera. Se lee/escribe online o no se toca.
- El mapeo visual completo, los perfiles múltiples por agencia y la tabla de `statusMap` siguen siendo
  **web** (§12 del README). Acá se elige entre lo que la plantilla ya sabe leer.

### 6.9 Asistente de primera vez (C10)

**Sí va.** El argumento en contra era *"la pantalla sola alcanza"*; es falso, porque el orden de §6.1
es **obligatorio**, no estético:

- Sin **Origen = Archivo** no existe ninguna de las otras preguntas (§6.2).
- Sin **Formato** no se sabe qué columnas hay para emparejar, y cambiarlo después **resetea `fields`**
  (invariante 4) — o sea: emparejar antes de elegir formato es trabajo que se tira a la basura.
- En Excel/CSV, **Emparejar columnas necesita un archivo de muestra** para leer los encabezados (§6.5).
- Sin **Alcance** el import ni siquiera arranca (`IMPORT_NOT_CONFIGURED`, §5).

Eso ya es un asistente: las dependencias existen igual. Lo único que se decide es si se **dibujan** o
si el usuario las descubre rompiéndose la cara. Se dibujan.

**Cómo, sin pantallas nuevas.** Es la misma `importacion.tsx` en modo primera vez —
*progressive disclosure*, la misma técnica que ya usa §6.2 al colapsar bajo `Manual`:

```
‹  Importación
─────────────────────────────────────────────
  Configurá tu importación · Paso 3 de 4        ← sólo la primera vez
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░
─────────────────────────────────────────────
  ORIGEN DE DATOS        ✓ Archivo
  ALCANCE DEL ARCHIVO    ✓ Empresa (todos)

  Formato del archivo    Elegí uno              ›   ← activo, resaltado
─────────────────────────────────────────────
  Reglas                 Ausentes: al día       ›   ← gris
  Emparejar columnas     Elegí el formato primero    ← gris, CON el motivo
```

| | |
|---|---|
| **Cuándo se activa** | `importConfig` no existe o le falta `scope`/`template`. Se apaga solo al completar los 4 pasos. No vuelve. |
| **Pasos** | 1 Origen · 2 Alcance · 3 Formato · 4 Emparejar columnas. **Reglas no es paso**: tiene default correcto (§5.2) y se cambia cuando quieras. |
| **Filas bloqueadas** | dicen **por qué**, no sólo se apagan: *"Elegí el formato primero"*. Un control gris sin motivo es un bug para el usuario. |
| **Volver atrás** | lo contestado queda visible con ✓ y se puede tocar. No secuestra la navegación: es la pantalla final, ordenada. |
| **Salir a medias** | no hay botón "saltar", pero se sale con el `‹` y lo contestado ya está guardado (guarda al toque, §6.8). Al volver, sigue donde estaba. |
| **Al terminar** | queda como §6.1, con `[ Probar con un archivo ]` (§7 · P1) resaltado una vez. |

**Costo:** una variable derivada (`step = primer campo faltante`) + `disabled` y un subtítulo en las
filas siguientes. Cero screens, cero componentes, cero controles duplicados — que era el motivo real
por el que un wizard *clásico* (pantallas aparte que repiten cada control) no valía la pena.

---

## 7. Lo que agregué pensando en el usuario (a confirmar)

Tres cosas que no pediste y que salen casi gratis porque el backend ya las tiene. Si alguna sobra,
se borra de acá y listo:

| # | Qué | Por qué | Costo |
|---|---|---|---|
| P1 | **`[ Probar con un archivo ]`** al pie de Ajustes | Es el `dryRun` que ya existe (N1). Deja verificar el emparejado sin importar nada. Sin esto, la única forma de saber si mapeaste bien es importar de verdad y ver la cartera rota. | ~0: reusa el flujo S3 con `dryRun:true` y sin confirmar. |
| P2 | **Última importación con conteo de errores en rojo** (§6.3) | Un import "exitoso" con 40 filas inválidas se ve idéntico a uno limpio si sólo mostrás agregados/actualizados/al día. | 1 tile más; el dato ya está en `client_import_runs.errors`. |
| P3 | **Cambiar a Manual no borra la config** (§6.2) | Alguien prueba `Manual` para ver qué pasa y pierde 10 minutos de emparejado. | 0: es no hacer nada. |

El asistente paso a paso pasó de "no lo hice" a **decidido y especificado** en §6.9 (C10).

---

## 8. Cambios de código que esto implica

Dos lotes. El primero **corrige código ya escrito** y no depende de nada de acá.

### 8.0 Auditoría de reuso del slice (verificada contra código, 2026-07-25)

La tabla grande está en el README §7; acá van sólo las capacidades que **agrega S1**.

| Capacidad | Estado | Path / evidencia |
|---|---|---|
| Endpoint de config | **EXTENDER** | `portfolio-import.controller.ts` — ya tiene `@Controller('imports/portfolio')` + los 3 guards + `CLIENT_IMPORT`. No se crea módulo `accounts` (§8.2 item 2). |
| Lectura de `importConfig` | **REUSAR** | `portfolio-import.service.ts:182` (`private importConfig()`), ya lee `account.configuration.importConfig`. |
| Última importación | **REUSAR** | `client_import_runs` con `creditsCreated/Updated/SetCurrent`, `errors`, `createdAt`, `template`, `scope`. **Sin columnas nuevas, sin migración** (§6.3). |
| Persistencia de la config | **REUSAR** | `Account.configuration Json @default("{}")` (schema.prisma). Sin tabla nueva. |
| Parser CSV | **REUSAR** | `apps/api/src/modules/clients/import/csv.ts` (existe, con tests). |
| Componentes de la pantalla | **REUSAR** | `ui.tsx`: `Header`,`ListRow`,`StatTile`,`Chips`,`SectionLabel`,`EmptyState`,`BottomSheet`,`OfflineIndicator` · `components.tsx:86`: `ErrorBanner`. **Cero componentes nuevos.** |
| Nombre del cliente separado | **REUSAR** | `Client.firstName`/`lastName` ya son `String?` → el split de §2.3 se escribe sin migración. |
| Respuesta `{data,meta,error}` | **REUSAR** | `TransformInterceptor` global (`main.ts`). El controller no envuelve a mano. |

**Artefactos NUEVOS de S1 (4), cada uno justificado:**

| Artefacto | Path | Por qué no se reusa nada |
|---|---|---|
| Catálogo de campos + invariantes | `apps/api/src/modules/imports/template-fields.ts` | La tabla §4.1 y los 6 invariantes de §3.1 los necesitan el `PATCH`, el service y (vía shared) la UI. En un solo lugar o se desincroniza en tres. |
| Parser `xlsx` | `apps/api/src/modules/imports/parsers/xlsx.parser.ts` | No hay lectura de Excel en el repo (dep `xlsx` aprobada, **no instalada**). Aislado por formato, igual que `banco-union.parser.ts`. |
| Screen de Ajustes | `apps/mobile/app/ajustes/importacion.tsx` | `app/ajustes/` no existe todavía (§8.2 item 8). |
| Screen de emparejado | `apps/mobile/app/ajustes/importacion-columnas.tsx` | §6.5. Se separa de la anterior porque tiene su propio `Header` y ciclo de vida (elegir archivo de muestra). |

### 8.1 Fix de FUNDACION — ausente ≠ cero (§2.1) · va **antes del merge**

Es la regla de §2.1 sola, sin `importConfig`. Hoy es destructivo y ya está commiteado (`790de8b`).

| # | Dónde | Qué |
|---|---|---|
| F1 | `banco-union.parser.ts:22` | `daysPastDue: number` → `number \| null`. `extractDaysPastDue` devuelve `null` si la columna no existe / no se pudo leer; `0` sólo si leyó un cero. |
| F4 | `banco-union.parser.ts:162` | `extractDaysPastDue(block)` → `extractDaysPastDue(block, header = 'Mora')`: el literal `'Mora'` de `:163` pasa a parámetro. Es lo único que hace falta en el parser para que §6.5.1 funcione — la búsqueda por X del encabezado ya es genérica. |
| F5 | `banco-union.parser.ts` (`:26` `BancoUnionParseResult`) | Sumar `columnCandidates: { header: string; samples: { clientName: string; value: number }[] }[]` al resultado del parseo, con 3 muestras por candidata. **Va en el resultado, no en un export suelto**: `TextItem` (`:31`) es privado y `parseBancoUnionPdf` sólo devuelve `blocks` (`:26-29`), así que una función exportada aparte no tendría con qué llamarse desde el controller. Se calcula sobre los items ya cargados en memoria — una pasada más, sin re-leer el PDF. |
| F6 | `banco-union.parser.ts` (`:22` y `:6`) | El comentario de `daysPastDue` dice *"0 si la columna está vacía"* → actualizarlo con F1 (`null`). Y el docblock cita `banco-union.calibration.test.ts`: el archivo real es **`.spec.ts`** (mismo error en README §5 punto 3). |
| F7 | `banco-union.parser.ts` + `ParsedCreditBlock` | Extraer **`Moratorios`** → `pastDueAmount`. Es una etiqueta más con la maquinaria que F5 ya monta, y paga dos deudas de una: es lo que la guarda `MORA_INCONSISTENTE` compara (§5) **y** llena el `pastDueAmount` que §4.1 hoy marca como *"está en el cuadro; no se extrae"*. Sin esto la guarda se queda apoyada sólo en `status = VIGENTE` y avisa mucho peor. |
| F2 | `portfolio-import.service.ts:201` (update) | `daysPastDue: b.daysPastDue` → `?? undefined`. Hoy escribe siempre → un archivo sin mora pone la cartera entera en 0. |
| F3 | `portfolio-import.service.ts:228` (create) | `daysPastDue: b.daysPastDue ?? 0` — la columna es `NOT NULL`; el default de §2 aplica **sólo al crear**. |

**Test mínimo (F):** en `banco-union.calibration.spec.ts` — un bloque sin columna `Dias Mora` parsea a
`null`, y `updateCredit` sobre un crédito con `daysPastDue=45` **no toca la columna**. Para F4/F5, y
**en reemplazo del `it.todo` de `:37`**: con el mismo archivo VIGENTE, `'Dias Int.'` devuelve `30` y
`'Dias Mora'` devuelve `0` — o sea, se prueba que **la columna configurada manda**, que es lo
verificable sin un extracto con mora. Una columna inexistente devuelve `null` (no `0`).
`columnCandidates` devuelve ambas con el nombre del cliente de cada muestra. F7: `pastDueAmount = 0`
en el archivo VIGENTE (y no `null`, que sería "no encontré la columna").

> **Medido, no estimado (2026-07-25):** en `mora union.PDF` la columna `Dias Mora` está en x=736 y
> **vacía**; `Dias Int.` en x=589 trae `18/31/31/30/31/30` por fila de movimiento. El parser lee la
> **última** fila (15/12/2024) → `30`. Ese contraste 30↔0 es toda la evidencia de que la elección
> del usuario tiene efecto real.

> **R1 deja de ser bloqueante** con F4/F5 + §6.5.1: la ambigüedad no se resuelve con un archivo que no
> podemos conseguir, se resuelve preguntándole al usuario y vigilándola con la guarda de
> `MORA_INCONSISTENTE`. F1–F3 siguen siendo necesarios igual (ausente ≠ cero).

### 8.2 S1 · Settings — `importConfig` completo

| # | Dónde | Qué |
|---|---|---|
| 1 | nuevo `template-fields.ts` | Tabla §4.1 + etiquetas en español de §2 + defaults (los 5 ⭐) + validación de los 6 invariantes §3.1. Un lugar, no tres. |
| 2 | N3 `GET`/`PATCH /api/imports/portfolio/config` **(reubicado)** | El README lo puso en `/api/accounts/me/import-config`, pero **no existe ningún módulo `accounts`** en la API (13 controllers, cero coincidencias de `@Controller('accounts')`) → montar un módulo entero para un endpoint contradice el reuso. Va en `portfolio-import.controller.ts`, que ya tiene el `@Controller('imports/portfolio')` con `JwtAuthGuard + TenantGuard + RolesGuard` y `Permission.CLIENT_IMPORT` puestos (`:24-31`). Lee/escribe `account.configuration.importConfig` reusando el `importConfig()` privado del service (`:182`); valida invariantes → 400 con código, no guarda basura. El `GET` devuelve además **`lastRun`** (último `client_import_runs` con contadores + `createdAt`/`template`/`scope`) para §6.3 — una sola llamada para toda la pantalla. |
| 3 | `portfolio-import.service.ts` | Extender `ImportConfig` (hoy 4 llaves, `:13`) con `fields`, `carriesAssignee`, `askOnLogin`, `nameOrder`; `scope.kind` gana `'account'` (§2.4) y `ref` pasa a `string \| null`. Aplicar `fields` antes de escribir: filtro `enabled`, chequeo `required`, `undefined` cuando no viene. Split de nombre según `nameOrder` en el `createMany` de clientes (`:134`). Autoasignación de §2.4. |
| 4 | `portfolio-plan.ts` | `MISSING_<CAMPO>` en `invalid[]` (recibe las reglas por `opts`, sigue puro). `AbsentRule` gana **sólo `'ask'`** → los ausentes elegibles salen en un balde `toDecide: string[]` y el plan **no** decide por ellos. **`toDelete` no existe** (§5.2): el docblock *"NUNCA borra"* de `:5` queda tal cual. |
| 5 | `portfolio-import.service.ts` (apply) | Con `'ask'`, el `POST` de confirmación recibe qué ausentes van a `set-current` (los que el usuario marcó) y el resto no se toca. Reusa el `updateMany` que ya existe (`:145`). Sin contadores nuevos, sin migración. |
| 6 | `portfolio-import.controller.ts:36` | `fileFilter` fijo en `application/pdf` → allowlist de los MIME de **todas** las plantillas (§4). El match contra la plantilla *configurada* (`BAD_MIME`) lo hace el service: `fileFilter` es síncrono y no ve el tenant, meterle una lectura de DB no vale la pena. |
| 5b | `portfolio-import.controller.ts` / service (respuesta del dry-run) | El `dryRun` devuelve **`columnCandidates`** además de la preview, **para toda plantilla** — es lo único que alimenta §6.5.1 y §6.5. Un modo *sólo encabezados* (`?columnsOnly=true`) evita correr el reconcile entero cuando el usuario sólo está configurando. |
| 7 | Parsers `csv` / `xlsx` | Nuevos: leen encabezados y devuelven filas por `column` + los mismos `columnCandidates` que F5 (contrato único para las 3 plantillas). `xlsx` = instalar la dep aprobada (R7). |
| 8 | Móvil `app/(tabs)/mas.tsx` + `app/ajustes/_layout.tsx` | **Hoy no hay ninguna pantalla de configuración**: `mas.tsx` tiene sólo "Perfil y seguridad" (con `onPress={() => {}}`) y "Cerrar sesión", y `app/ajustes/` no existe. S1 crea la carpeta y la fila **Configuración › Importación** (visible sólo con `CLIENT_IMPORT`). Es la puerta de §6 y del README §9 — sin esto la pantalla es inalcanzable. |
| 9 | Móvil `app/ajustes/importacion.tsx` | La pantalla de §6.1–§6.4, §6.6–§6.8 **+ el modo primera vez de §6.9** (`step` derivado + `disabled` con motivo). `ListRow` + `Chips` + `StatTile` + `BottomSheet` + `ErrorBanner`/`OfflineIndicator`. Cero componentes nuevos. |
| 10 | Móvil `app/ajustes/importacion-columnas.tsx` | El screen de §6.5 (emparejado + botón `+` + nombre) **+ el BottomSheet de calibración de §6.5.1** con los valores de muestra. |
| 10b | `fields.daysPastDue` + Vista Previa | Sumar `calibrated: boolean` (§6.5.1) + invariante 7. Nuevo balde **`warnings[]`** en la respuesta (≠ `invalid[]`, §5): `MORA_INCONSISTENTE` por fila + banner sobre el 20 %, y `MORA_SIN_CONFIRMAR` una vez por corrida. |
| 11 | Móvil — dep `expo-document-picker` | **No está instalado** (`package.json` sólo trae `expo-secure-store`). Aprobada en R7 pero agendada para S3; **se adelanta a S1** porque §6.5 la necesita para leer los encabezados del Excel de muestra y §7·P1 para "Probar con un archivo". Sin ella, S1 sólo se puede terminar con PDF. |
| 12 | Móvil `src/post-login.ts` | La condición del gate suma `askOnLogin` (§6.7). |
| 13 | Móvil Vista Previa (S3) | **Siguen siendo 3 baldes.** Con `absentRule: 'ask'`, la lista de ausentes con dos acciones por crédito (al día / dejar como está) antes de confirmar (§5.2). |
| 14 | `portfolio-import.service.ts:159` | `scope: \`${scope.kind}:${scope.ref}\`` escribiría **`"account:null"`** con el alcance nuevo (§2.4). Serializar `'account'` a secas; el resto igual. Una línea, pero ensucia toda la tabla de corridas si se pasa por alto. |

**Test mínimo (S1):** `template-fields.spec.ts` — los 6 invariantes + una fila a la que le falta un
campo `required` cae en `invalid` y **no** llega a `toCreate`/`toUpdate`.
`portfolio-plan.spec.ts` (existente) — `absentRule:'ask'` manda los ausentes elegibles a `toDecide` y
**nada** a `toSetCurrent`; ningún valor de `absentRule` produce escrituras en `deletedAt`.
`client-name.spec.ts` — el split de §2.3 con 2, 3 y 5 palabras + partícula.

> ✅ **`README.md` restaurado** (2026-07-25). Al caerse la opción de eliminar, su §4 (*"el reconcile
> NUNCA borra"*), su §6.2 y su §14 (*"Eliminados = 0, siempre"*) siguen siendo verdad palabra por
> palabra. Lo único que se le corrigió: **N3 reubicado** (§8) y §9 apuntando acá.

---

## 9. Rama, verificación y DoD del slice

**Rama:** `f10/import-s1-settings`, sobre `f10/rutas-fundacion` (⚠️ **no sobre `main`**: `Credit.metadata`
y la migración `@@unique(accountId,code)` viven ahí, no en main).

**Build:** 🔵 dev build — igual que el resto del módulo (README §10).

**Verificación (headless, la corro yo):**
- `pnpm --filter @kobrax/api test` — incluye `template-fields.spec.ts`, `portfolio-plan.spec.ts`, `client-name.spec.ts`.
- `pnpm --filter @kobrax/mobile type-check` + `test` + `npx expo export --platform android`.
- `/code-review` + `/ponytail-review` en verde.

**DoD funcional:**
1. Cuenta sin `importConfig` → la pantalla abre en **modo primera vez** (§6.9) y no deja llegar a
   "Emparejar columnas" antes de elegir formato.
2. `Origen = Manual` → la pantalla queda en una sola fila; volver a `Archivo` **recupera** todo lo
   configurado (§6.2).
3. `Alcance = Empresa (todos)` con un solo cobrador → no aparece el paso de reparto y el crédito
   importado queda con ese `assignedManagerId` (§2.4).
4. Marcar `Cuota` como Obligatorio con la plantilla PDF → **400 `FIELD_NOT_IN_TEMPLATE`**, la UI
   revierte el control y muestra `ErrorBanner` (§3.1 inv. 2 + §6.8).
5. Un Excel con una columna emparejada que se renombró → **`COLUMN_NOT_FOUND`**, no importa a medias.
6. `nameOrder = 'surnames-first'` → `MARTINEZ DURAN JUAN ANTONIO` entra como
   `lastName: 'MARTINEZ DURAN'` / `firstName: 'JUAN ANTONIO'` (§2.3).
7. `askOnLogin = false` → el gate post-login no dispara; `Más › Importar datos` sigue funcionando.
8. Ninguna combinación de `absentRule` escribe `deletedAt` (§5.2).
9. **Calibración (§6.5.1):** el BottomSheet de `Días de retraso` lista `Dias Int.` y `Dias Mora` con
   los valores reales de `mora union.PDF` (`30` y vacío); elegir `Dias Int.` y correr un dry-run
   importa `30` en vez de `0` — o sea, la elección **manda de verdad**. Sin confirmar, la preview avisa.

**Validación visual por la usuaria** (emulador + gama baja), como todo slice F10.

---

## 10. Fuera de alcance — declarado, no olvidado

| Qué | Por qué no ahora |
|---|---|
| **Match con IA leyendo el documento** (C9) | Se construye sobre el mismo `fields`: la IA propone el emparejado, el usuario confirma en la pantalla de §6.5. No cambia el modelo de datos → se puede sumar después sin migrar nada. |
| **Detección automática de apellido/nombre** (§2.3) | Necesita diccionario de apellidos LatAm o modelo. La pregunta única de §2.3 cubre el 100 % de los casos mientras tanto. |
| **Permisos por rol y oficina en el import** (§2.4) | Depende de roles/oficinas (F3/P10 · R4). Hoy: quien tiene `CLIENT_IMPORT` importa según el alcance configurado. |
| **Perfiles múltiples de importación** (una agencia, varios formatos) | Web (README §12). En móvil, un tenant = un `importConfig`. |
| **Tabla de equivalencias de estados editable** (`statusMap`) | Web (README §12). En móvil se usa el mapa mínimo del código. |
| **Programación automática** (importar solo a las 7am) | Necesita el archivo en un lugar accesible sin el usuario. Otro módulo. |
