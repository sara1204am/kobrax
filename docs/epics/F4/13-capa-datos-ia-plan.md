# F4/13 · Capa de datos para la IA: plan por etapas

Estado: **implementado E1–E5; E6 verificada** (2026-10-10). Gate PASS (ver §11). Resultado por etapa en §10. Parte de
[`docs/producto/ia-plan-maestro.md`](../../producto/ia-plan-maestro.md) §2 (capa A) y de la lectura del código hecha el
mismo día; los números de línea citados corresponden a la rama `docs/ia-capa-datos` (desde `dev`).

**Registro de decisiones:** [`13-capa-datos-ia-decisiones.md`](./13-capa-datos-ia-decisiones.md) (cada decisión, su motivo
y quién la tomó).

**Rama:** `docs/ia-capa-datos` (desde `origin/dev`), un commit por etapa. No hay PR ni merge: ambos requieren la
autorización escrita de la fundadora.

**Objetivo.** Guardar de forma estructurada lo que hoy se pierde en la memoria del cobrador o en notas de texto libre:
de qué vive el deudor, cuándo le llega el dinero, por qué no pagó, cómo conviene cobrarle y qué plantilla se usó. Que
esos datos **mejoren la aplicación sin IA** (reglas de la capa B) y queden listos para alimentar la IA después.

## 0. Decisiones

### 0.1 Tomadas por la fundadora

| # | Decisión | Efecto |
|---|---|---|
| K1 | El aprendizaje es memoria y contexto, **sin modelo propio de ML** | Esta capa solo guarda datos; no entrena nada |
| K5 | **Sin aprendizaje entre cuentas** por ahora | Todo dato queda por `account_id`; sin anonimización entre cuentas |
| — | Se trabaja **por capas**, empezando por los datos; rama propia sobre `dev` | Este plan |

### 0.2 Supuestos (S1–S4 confirmados por la fundadora el 2026-10-10; S5–S7 decididos por delegación)

| # | Supuesto | Por qué | Estado |
|---|---|---|---|
| S1 | Los catálogos por defecto **se siembran al registrar una cuenta** y se hace un **backfill** para las existentes | Hoy el registro no siembra catálogos (verificado): una cuenta nueva nace vacía | **Confirmado** (D-01) |
| S2 | El perfil de ingreso es **del cliente**; un crédito puede sobrescribirlo más adelante | Un cliente puede tener un crédito productivo y uno de consumo | **Confirmado** (D-02) |
| S3 | El motivo de no pago es **opcional**, no obligatorio | La cola offline puede traer gestiones antiguas sin él; hacerlo obligatorio las rechazaría con 400 | **Confirmado** (D-03) |
| S4 | El catálogo `ZONE` **queda fuera** de este plan | `zone` es texto libre hoy; normalizarlo es otro trabajo (§8) | **Confirmado** (D-04) |
| S5 | `template_code` significa **plantilla elegida**, no «enviada» | `wa.me` no confirma el envío (verificado) | Delegado (D-05) |
| S6 | No se sube `QUEUE_VERSION` | Los campos nuevos son opcionales; subirla marca ítems antiguos como no soportados | Delegado (D-06) |
| S7 | Se reutilizan permisos existentes (`catalog:write`, `client:write`, `collection:write`) | No hay permisos nuevos que gestionar | Delegado (D-07) |

Las decisiones D-11 a D-17 (motivo en visita de ruta, quién responde, auditoría, canal preferido, tabla propia, perfil de
cobro y migraciones) están en el registro de decisiones.

## 1. Principios (no se tocan)

- **Todo dato nuevo es opcional.** Ninguna regla puede asumir que existe; las cuentas y gestiones antiguas siguen válidas.
- **Origen registrado.** Cada dato guarda si vino de forma manual, dictada o importada (para la IA después).
- **`credit_activities` es append-only:** solo se agregan columnas nulables, no se reescribe nada.
- **Una sola fuente de verdad de las reglas:** el validador compartido (`validateRecoveryActivity`) para API, web y móvil.
- **Despliegue en orden: API → shared → web y móvil.** El validador global rechaza con 400 los campos que no conoce
  (`whitelist` + `forbidNonWhitelisted`, verificado en `validation-pipe.ts:30-31`).
- **Offline primero:** lo que el cobrador captura en campo debe poder encolarse.
- **Todas las tablas nuevas con `account_id` y RLS** (principio no negociable #1).

### 1.1 Auditoría de reuso

Qué existe y qué se hace con ello. Nada de lo NUEVO reimplementa algo que ya esté.

| Capacidad | Existe | Decisión | Dónde |
|---|---|---|---|
| Catálogos por cuenta (CRUD, auditoría, `metadata`) | `catalogs` module, `catalog_items` | **REUSAR** | `apps/api/src/modules/catalogs` |
| Tipos de catálogo | Enum duplicado en Prisma y `shared` | **EXTENDER** los dos | `schema.prisma:1659`, `agenda.enum.ts:86` |
| Catálogos por defecto | Arreglo `CATALOGS` solo en `seed.ts` | **EXTENDER** y **MOVER** a `shared` | `seed.ts:167` → `packages/shared` |
| Siembra al registrar | Solo `arrearCategory` | **EXTENDER** | `accounts.service.ts:116` |
| Hidratación de catálogos al móvil | Lista fija de 6 tipos | **EXTENDER** | `sync/hydrate.ts:39-46` |
| Select con catálogo y fallback a texto libre | `CollateralFields` | **REUSAR** el patrón | `client-form.tsx:667` |
| Edición de cliente por sección y diff | `section-editor.tsx`, `diffCliente` | **EXTENDER** | `client-diff.ts:150` |
| Cola offline de cliente | `client.update`, `client.location` | **REUSAR**; kind nuevo solo para el perfil de ingreso | `queue.ts`, `cliente-queue.ts` |
| Validador de gestión | `validateRecoveryActivity` | **EXTENDER** (única fuente) | `recovery-activity.ts:73` |
| Registro de gestión | `addActivity`, `recordCreditActivity` | **EXTENDER** | `mora.service.ts:311`, `credit-activity.ts:15` |
| Auditoría | `AuditService.record` | **REUSAR** | `common/audit/audit.service.ts` |
| RLS por tabla | Arreglo `operational` + patrón inline | **REUSAR** | `rls/001_enable_rls.sql`, `device_push_tokens` |
| Esquema de perfil de cobro | No existe | **NUEVO** | `packages/shared/src/utils/collection-profile.ts` |
| Perfil de ingreso (tabla, endpoints, tipos) | No existe | **NUEVO** | ver E3 |
| Ciclos de ingreso | No existe | **NUEVO** (enum y etiquetas) | `packages/shared/src/enums` |

### 1.2 Artefactos NUEVOS y su justificación

| Artefacto | Por qué es nuevo | Ubicación (se usa en ≥ 2 apps, por eso va en `shared`) |
|---|---|---|
| `CATALOG_DEFAULTS` | Seed y registro deben compartir una fuente | `packages/shared/src/constants` |
| `collection-profile.ts` (esquema y validación de `visit_schedule`) | Hoy es un JSON sin contenido definido | `packages/shared/src/utils` |
| `IncomeCycle`, `PayerParty`, `ActivityOrigin` | Enums de dominio usados por API, web y móvil | `packages/shared/src/enums` |
| `client_income_profiles` | No cabe en `clients` ni en `metadata` (D-15) | `packages/database` |
| Endpoint del perfil de ingreso | Recurso nuevo con idempotencia propia | `apps/api/src/modules/clients` |

### 1.3 Contrato de los endpoints nuevos

Respuesta estándar `{ data, meta, error }`. Prefijo `/api`. Guards: JWT, tenant y roles, como el resto de `clients`.

| Método | Ruta | Permiso | Cuerpo | Respuesta (`data`) | Errores |
|---|---|---|---|---|---|
| GET | `/clients/:id/income-profile` | `client:read` | — | Perfil o `null` si no existe | 404 si el cliente no existe o no es de la cuenta |
| PUT | `/clients/:id/income-profile` | `client:write` | `{ incomeSourceCode?, occupationCode?, incomeCycle?, incomeDay?, notes?, origin? }` | Perfil guardado | 400 validación; 404 cliente |
| PATCH | `/clients/:id/locations/:locationId` (existente) | `client:write` | Se agrega `visitSchedule?`, `riskLevel?` | Ubicación con `visitSchedule` | 400 si el contenido no cumple el esquema |
| POST | `/mora/:creditId/activities` (existente) | `collection:write` | Se agregan `reasonCode?`, `expectedIncomeDate?`, `payerParty?`, `origin?` | Actividad con los campos nuevos | `MORA_*` existentes; 400 para campo desconocido |
| GET/POST/PATCH/DELETE | `/catalogs/:catalog` (existente) | `catalog:read` / `catalog:write` | Para los tipos nuevos, `metadata` validado contra su esquema | Ítem | 400 si `metadata` no cumple |

`PUT` es idempotente: repetirlo con el mismo cuerpo no cambia el resultado.

### 1.4 Reglas de la fase

1. **Todo dato nuevo es opcional**; ninguna regla asume que existe.
2. **API → shared → web y móvil**, en ese orden de despliegue.
3. **Sin `any`**; `strict` en todos los `tsconfig`.
4. **Offline primero:** lo que se captura en campo debe poder encolarse; nunca se bloquea una acción por falta de red.
5. **Multi-tenant por `account_id` y RLS**; ningún comportamiento depende de `tenantType`.
6. **La API valida igual aunque la interfaz oculte**: los permisos no se delegan a la pantalla.
7. **Auditar** cada mutación nueva, sin texto libre ni datos personales.
8. **Un spec nuevo de la API se agrega al script `test`** o no corre.
9. **i18n es/en en paralelo**.
10. **No se modifican migraciones ya ejecutadas.**

## 2. Orden de las etapas

```
E1 Catálogos ──► E2 Perfil de cobro ──► E3 Perfil de ingreso ──► E4 Motivo en la gestión ──► E5 Plantilla
   (base)          (usa visitSchedule)     (tabla nueva)            (columnas nuevas)         usada
                                                                          │
                                                                          └──► E6 Importación (verificación)
```

| Etapa | Entrega visible | Depende de | Esfuerzo |
|---|---|---|---|
| **E1** | Catálogos sembrados y editables; el móvil los baja | — | M |
| **E2** | Perfil de cobro editable en web y móvil | E1 | M |
| **E3** | Fuente de ingreso, rubro y ciclo en la ficha del cliente | E1 | M-L |
| **E4** | Motivo de no pago y fecha esperada al registrar una gestión | E1 | M-L |
| **E5** | Código de plantilla guardado en la gestión | E4 | S-M |
| **E6** | Verificar si la importación puede traer rubro, ciclo o tipo | E3 | S |

Cada etapa se puede entregar sola y deja la aplicación funcionando. E2, E3 y E4 son independientes entre sí tras E1.

---

## Etapa 1 · Catálogos base y siembra

**Qué cambia.** Cuatro catálogos nuevos y su siembra por defecto.

| Catálogo | Contenido inicial | `metadata` |
|---|---|---|
| `INCOME_SOURCE` | Asalariado/profesional · Comerciante/productivo · Otro | — |
| `OCCUPATION` | Transportista, funcionario público, comerciante, productor, construcción, servicios, docente, otro | `incomeSource`, `defaultCycle`, `synonyms[]` |
| `NO_PAYMENT_REASON` | Los motivos de [`ia-aprendizaje-efectividad.md`](../../producto/ia-aprendizaje-efectividad.md) §12.4 | `appliesTo[]`, `suggestion`, `asksExpectedIncomeDate`, `triggersContactUpdate`, `sensitive` |
| `COLLECTION_MODALITY` | Visita en negocio · en domicilio · recoger la cuota · paga en oficina · transferencia o QR | — |

> Las listas son **borrador**: se validan con cobradores reales (plan maestro M5) y cada cuenta las puede editar. Se
> siembran con la lista inicial; el valor está en que existan y se puedan ajustar.

### Trabajo

**Base de datos**
- Una migración **por valor** del enum, con solo `ALTER TYPE "CatalogType" ADD VALUE IF NOT EXISTS '<X>';`
  (patrón de `20260814230000_add_credit_type_catalog`; `ADD VALUE` no puede convivir con su uso en la misma
  transacción de Prisma). Orden posterior a `20261010000000`.
- Valores nuevos en `schema.prisma:1659-1675`.

**Shared**
- Espejo del enum en `packages/shared/src/enums/agenda.enum.ts:86-102` (hoy duplicado a mano).
- Mover la lista de catálogos por defecto desde `seed.ts` (arreglo `CATALOGS`, línea 167) a `packages/shared` para
  que la usen **el seed y el registro**.
- Esquema validado de `metadata` por catálogo (nuevo util con su spec).

**API**
- `accounts.service.ts` (~95-110): sembrar catálogos junto a `arrearCategory.createMany`, dentro del mismo `withTenant`.
- Script de backfill idempotente (`createMany` + `skipDuplicates`) para cuentas existentes.
- `CreateCatalogItemDto.metadata` es `@IsObject` sin esquema: validar el contenido para los tipos nuevos.
- `catalogs.service.ts`: `update` y `remove` usan solo el `id`, sin filtrar por catálogo (verificado); corregirlo.

**Móvil**
- Agregar los 4 tipos a `CATALOGOS` en `sync/hydrate.ts:39-46`; sin eso no bajan al teléfono.
- Ampliar `CatalogOption.metadata` (`catalogs.service.ts:13`).

**Web**
- Ampliar `CatalogOption` con `metadata?` (`components/client-form.tsx:41`).
- Pantalla para editar estos catálogos en `/cuenta` (junto a las plantillas de WhatsApp). *No verificado* si ya hay
  un patrón reutilizable.

### Pruebas
- `catalogs.service.spec.ts`: validación de metadata y no cruzar tipos en `update`/`remove`.
- `accounts.service.spec.ts`: el registro siembra los catálogos.
- shared: códigos únicos y metadata válida en las listas por defecto.
- Integración: cuenta nueva con catálogos; backfill idempotente.

### Criterio de aceptación
Una cuenta recién registrada, y una existente tras el backfill, muestran los 4 catálogos con su lista; el móvil
los tiene sin red tras una hidratación; editar un ítem no afecta a otro tipo.

---

## Etapa 2 · Perfil de cobro (A3)

**Qué cambia.** El horario y la modalidad de cobro del cliente dejan de ser un campo sin salida.

**Hallazgo que cambia el plan original:** `visit_schedule` **no es solo «sin pantalla»**. Hoy solo se escribe en
`POST /clients/:id/locations`; el **alta atómica lo descarta** (`mkLocation`, `clients.service.ts:197-202`),
**no se puede editar** (`UpdateLocationDto` no lo tiene, `client.dto.ts:59-72`) y **ningún endpoint lo devuelve**
(`serializeLocation`, `clients.serializer.ts:66-79`). Lo mismo ocurre con `riskLevel`.

### Trabajo

**Shared**
- Esquema validado del perfil de cobro: `{ modality, frequency, window:{from,to}, days[], handoverBy, note }`,
  con su spec. `modality` referencia el catálogo `COLLECTION_MODALITY`.
- `NewLocationInput` (`client.types.ts:22`), `ClientLocationDetail` (:176) y `LocationRow` (:487): agregar `visitSchedule`.
- `preferredContactChannel` → `ClienteForm` (:531), `initialCliente`, `hydrateCliente`, `buildClientePayload`
  (`client-form.ts:378`) y `diffCliente` (`client-diff.ts:150`, `ClienteOps.client` es un `Pick` cerrado).

**API**
- `UpdateLocationDto` acepta `visitSchedule` (y `riskLevel`).
- `mkLocation` del alta atómica copia `visitSchedule` y `riskLevel`.
- `updateLocation` (`clients.service.ts:838-859`) lo persiste.
- `serializeLocation` lo devuelve.
- Validación del contenido contra el esquema compartido.
- `preferredContactChannel`: acotar a valores conocidos (hoy `@IsString()` libre).

**Web**
- `client-form.tsx`: bloque «Cómo cobrarle» en `LocationRows` (:247), con select de modalidad, horario y quién entrega.
- `client-card.tsx`: mostrarlo en la ficha; `section-editor.tsx`: nueva sección `'collection'` (`SectionKey` es una
  unión cerrada).
- `lib/client-ops.ts` (`opsRequests`, :35): rama para actualizar la ubicación.
- i18n es/en (`portfolio.sections`, `portfolio.form`); `messages.test.ts` exige paridad.

**Móvil**
- `cliente-form-view.tsx`: bloque en `LocationsSection` (:187).
- `UpdateClientPatch` (`clients.service.ts:170`) es un tipo **cerrado y local**: agregar `preferredContactChannel`.
- `app/cliente/[id].tsx` (:380-412): mostrar en `DataRow`.
- Offline: las ubicaciones ya viajan por la cola `client.location`; verificar que acepte el campo nuevo.

### Pruebas
- shared: esquema válido/ inválido; `client-diff.test`, `client-form.test`.
- API: alta con `visitSchedule` lo conserva (hoy se pierde); update y serializer.
- Web: `client-form` y ficha; móvil: `cliente-diff.test.ts`, `cliente-queue.test.ts`.

### Criterio de aceptación
Un cliente creado con horario de cobro lo conserva, se ve en la ficha y se edita; un cliente antiguo sin él sigue
funcionando; ítems antiguos de la cola se envían igual.

---

## Etapa 3 · Perfil de ingreso (A2)

**Qué cambia.** Fuente de ingreso, rubro y ciclo de ingreso por cliente.

**Hallazgo:** no entra en `PATCH /clients/:id` ni en `ClienteOps.client`; necesita endpoint propio, un campo nuevo en
`ClienteOps` y un `kind` nuevo en la cola del móvil. `clients.metadata` queda descartado: ya guarda `linkSuggestions`
y `update` lo reemplaza entero sin mezclar (`clients.service.ts:705-706`).

### Trabajo

**Base de datos**
- Tabla `client_income_profiles` (`client_id` único, `income_source_code`, `occupation_code`, `income_cycle` enum
  `DAILY|WEEKLY|BIWEEKLY|MONTHLY|QUARTERLY|SEASONAL|IRREGULAR`, `income_day`, `origin` enum
  `MANUAL|DICTATION|IMPORT|SUGGESTION_ACCEPTED`, `declared_by`, `declared_at`, `notes`).
- RLS: agregar al arreglo `operational` de `rls/001_enable_rls.sql` **y** dejarlo inline en la migración (patrón de
  `20261010000000_device_push_tokens`). Recordar que el script se aplica a mano.

**API**
- `GET` y `PUT /clients/:id/income-profile`, con `client:read` / `client:write`.
- `audit.record({ entity: 'client_income_profile', … })` en alta y edición.
- Incluirlo en el detalle del cliente.

**Shared**
- Tipos, validación y `ClienteOps` ampliado.

**Web**
- Tarjeta «Perfil de ingreso» en la ficha; sección nueva `'income'` en `section-editor.tsx`; rama en `client-ops.ts`.
- Select de rubro con **fallback a texto libre si el catálogo viene vacío** y que conserve un código ya guardado que
  salió del catálogo (patrón de `CollateralFields`, :667).

**Móvil**
- Campos en alta y edición del cliente; `queueableOps` / `opsToActions` (`cliente-queue.ts:62,76`): el perfil es
  un **valor fijo** (idempotente), así que puede encolarse; kind nuevo `client.income` en `queue.ts` con su entrada en
  `ACTION_LABEL` y su `case` en `send`.

### Pruebas
API (spec con `tx` simulado, patrón de `mora.activity.spec.ts`) más una prueba de integración que verifique **RLS
forzada** de la tabla nueva (patrón de `push-devices.it.ts`); web y móvil como en E2.

### Criterio de aceptación
Se registra el rubro y ciclo de un cliente en web y móvil, también sin red; se ve en la ficha; otra cuenta no puede
leerlo; un cliente sin perfil no rompe ninguna pantalla.

---

## Etapa 4 · Motivo de no pago en la gestión (A4)

**Qué cambia.** Al registrar una gestión sin pago, se puede indicar el motivo, la fecha esperada de ingreso y quién
responde realmente.

### Trabajo

**Base de datos**
- Columnas **nulables** en `credit_activities`: `reason_code`, `expected_income_date`, `payer_party` (enum
  `HOLDER|GUARANTOR|CODEBTOR|BENEFICIARY|NOT_LOCATED`), `payer_relation_id`, `origin` (`MANUAL|DICTATION`).
  Los enums nuevos se crean en la misma migración.

**Shared** (único punto de la regla)
- `RecoveryActivityInput` (`recovery-activity.ts:37`) y `validateRecoveryActivity` (:73): campos nuevos y reglas.
- **Reglas, todas permisivas con lo antiguo:** el motivo solo se admite en gestiones **sin** promesa de pago;
  `expectedIncomeDate` solo con un motivo que lo pida; el campo **no es obligatorio** (S3).
- Cada código de error nuevo rompe la compilación en dos mapas exhaustivos: `ACTIVITY_ERROR_TEXT`
  (`mora-ficha.ts:409`) y `panel.mora.ficha.activity.errors` (es/en), además de `ACTIVITY_ERRORS` de la API.

**API**
- `ActivityPromiseDto` y `CreateMoraActivityDto` (`mora.dto.ts:131-154`): declarar los campos nuevos.
- `addActivity` (`mora.service.ts:311-385`) y `recordCreditActivity` (`credit-activity.ts:15-37`, lista cerrada de
  campos) y `serializeCreditActivity` (:42-60, lista cerrada).
- **Auditar** la actividad (hoy `addActivity` no lo hace): `audit.record` con motivo y origen, sin texto libre.
- Decidir los otros dos escritores: `agenda.service.ts:582` (completar una gestión agendada) y `field.service.ts:356`
  (visita de ruta). **Propuesta:** E4 cubre mora y agenda; la visita de ruta queda para una etapa posterior.

**Web**
- `activity-form.tsx` (`RegisterActivityButton`, :39): estado (:60-70), `input` de validación (:76-83) y payload
  (:115-120). El motivo aparece **solo cuando el resultado no es pago** (condición sobre `result`, :73).
- `ficha-gestion.tsx`: leer `NO_PAYMENT_REASON` en el `Promise.all` (:75) y pasarlo por prop; filtrar los motivos por
  la fuente de ingreso del cliente.

**Móvil**
- `gestion-sheet.tsx`: ampliar el tipo de `onSubmit` (:53-58) y el payload (:98); cargar el catálogo (:76).
- Los dos llamadores deben cambiar a la vez: `app/cliente/[id].tsx:519` y `app/mora/[creditId].tsx:327`.
- Cola: `mora.activity` pasa el `input` entero, así que los campos fluyen; **no se sube `QUEUE_VERSION`** (S6).

### Riesgos de compatibilidad
- **App nueva contra API vieja:** un campo desconocido da 400 permanente y la gestión queda rechazada. Mitigación:
  desplegar la API primero y forzar actualización con el 426 que ya existe.
- **Ítems antiguos de la cola:** no traen el campo; como es opcional, se envían igual.
- `payer_relation_id` podría referirse a una relación local (`local:`) aún no sincronizada. *No verificado* cómo se
  resolvería (`resolveLocalIds`, `queue.ts:596`, hoy solo traduce `contactId` y `locationId` de la agenda).

### Pruebas
`recovery-activity.spec.ts` ampliado; `mora.activity.spec.ts`; web `activity-form.test.tsx`; móvil
`mora-actions.test.ts` (vigila cada par tipo/resultado), `sync/queue.test.ts`; `i18n/messages.test.ts`.

### Criterio de aceptación
Se registra una gestión con motivo en web y móvil (con y sin red); el historial lo muestra; una gestión sin motivo
sigue siendo válida; la fecha esperada solo aparece con el motivo que la pide.

---

## Etapa 5 · Plantilla usada (A4, parte final)

**Hallazgo:** hoy el código de la plantilla **no se guarda en ningún lado**. `pick` en `agenda-register.tsx` descarta
`t.code`; `new-task-modal.tsx:474-488` en la web hace lo mismo. Y la gestión de mensajes de agenda se completa con
`completeItem` (agenda), no como `mora.activity`.

### Trabajo
- Guardar `templateCode` en `details` del ítem de agenda al elegir la plantilla (web `new-task-modal`, móvil
  `agenda/crear.tsx` y `agenda-register.tsx`).
- Propagarlo al completar la gestión hacia `credit_activities.template_code` (columna nueva, nulable).
- `trace.ts` (`registrarRastro`) no lleva plantilla; queda fuera.

### Decisión pendiente
¿Cuál es la fuente de verdad del mensaje: el ítem de agenda o la actividad `MESSAGE`? Se propone la **actividad**
(es lo que se analiza), con el código copiado desde el ítem.

### Criterio de aceptación
Una gestión de WhatsApp completada desde una plantilla queda con su código; las anteriores quedan en blanco.

---

## Etapa 6 · Importación (verificación)

No se construye: se **verifica** si el archivo de cartera puede traer rubro, ciclo o tipo de crédito y si
`typeCode` se mapea (solo aparece nulo en `portfolio-credit.spec.ts:102`). Si se puede, se abre un plan aparte (A5).

---

## 3. Transversales

| Tema | Regla |
|---|---|
| **Migraciones** | Nombre descriptivo, orden posterior a `20261010000000`; un `ADD VALUE` por migración; no modificar las ya ejecutadas |
| **RLS** | Tabla nueva en `001_enable_rls.sql` **y** inline en su migración; aplicar a mano en cada entorno |
| **Pruebas de la API** | El script `test` de `apps/api/package.json` **enumera los specs a mano**: agregar los nuevos o no corren. Ya hay uno omitido (`agenda-overdue.spec.ts`) |
| **Auditoría** | `audit.record` en las mutaciones nuevas, sin texto libre |
| **i18n** | es y en en paralelo (`messages.test.ts`) |
| **Despliegue** | API → shared (reconstruir `dist`) → web y móvil; en web reiniciar `dev` tras cambiar shared |
| **Documentación viva** | Actualizar `modelo-de-datos.md`, `backend-modulos-y-reglas.md` (lista de tipos de catálogo, :143) y las pantallas tocadas |
| **Zona horaria** | `expected_income_date` es un día civil; se interpreta con el reloj del tenant |

## 4. Pruebas y definición de terminado (DoD)

Por etapa: pruebas unitarias del validador y servicios, más **una prueba de integración por tabla nueva** que
compruebe RLS.

**Comandos de verificación** (todos deben pasar antes de cerrar una etapa):

| Paquete | Comando | Cuándo |
|---|---|---|
| `packages/database` | `pnpm --filter @kobrax/database db:generate` y `type-check` | Si cambia `schema.prisma` |
| `packages/shared` | `pnpm --filter @kobrax/shared build`, `type-check`, `test` | Siempre que se toque |
| `apps/api` | `pnpm --filter @kobrax/api type-check` y `test` | Siempre que se toque |
| `apps/api` | `pnpm --filter @kobrax/api test:integration` | Etapas con tabla o migración nueva |
| `apps/web` | `pnpm --filter @kobrax/web type-check` y `test` | Siempre que se toque |
| `apps/mobile` | `pnpm --filter @kobrax/mobile type-check` y `test` | Siempre que se toque |

La app Expo no corre sin cabeza: la **validación visual en teléfono la hace la fundadora**; el resultado de cada etapa
dice qué quedó por validar. Una etapa no se da por cerrada si falla alguno de los comandos aplicables.

## 5. Datos de prueba

Ampliar `seed.ts` para las cuentas DEMO con: catálogos nuevos, perfiles de ingreso variados (asalariado, comerciante,
ciclo trimestral), perfiles de cobro (cobro diario en negocio) y gestiones con motivo. Es lo que permitirá demostrar la
capa B después.

## 6. Criterios de aceptación globales

- Ninguna pantalla ni flujo existente cambia de comportamiento si los datos nuevos están vacíos.
- Los datos nuevos se capturan también **sin red** y se sincronizan.
- Cada dato nuevo queda con su origen y su autor.
- Ningún dato nuevo cruza entre cuentas (RLS verificada por prueba).
- Web y móvil muestran los mismos campos con los mismos textos.

## 7. Qué NO cambia de la gestión actual

Los resultados válidos por tipo, la regla «promesa de pago ↔ datos de promesa», el id idempotente de la cola y la
inmutabilidad de `credit_activities`.

## 8. Fuera de este plan

| Tema | Dónde sigue |
|---|---|
| **Reglas de la capa B** (fecha de promesa por ciclo, rutas por zona, prioridad v2) | Plan siguiente, sobre estos datos |
| **Agenda recurrente** | [`agenda-recurrencia.md`](../../producto/agenda-recurrencia.md) |
| **Catálogo `ZONE` y normalización de zonas** | Pendiente; requiere decidir geocodificación |
| **`ai-gateway`, dictado, memoria** | Capa C |
| **Motivo en la visita de ruta** (`field.service.ts:356`) | Etapa posterior a E4 |
| **Perfil de ingreso por crédito** | Cuando se valide S2 con un caso real |

## 9. Por verificar antes de empezar

1. ¿Hay un patrón reutilizable en `/cuenta` para editar catálogos distintos de las plantillas de WhatsApp?
2. ¿Cómo despacha la cola de agenda los campos nuevos (`onOpenLink` y `agenda/crear.tsx` del móvil)?
3. ¿Qué valor de `preferredContactChannel` se usa hoy en los datos existentes, antes de acotarlo?
4. ¿La visita de ruta (`field.service.ts`) debe aceptar motivo desde ya?
5. Resolución de `payer_relation_id` cuando la relación es local y aún no sincronizada.

## 10. Resultado de la implementación

### E1 · Catálogos base y siembra ✅ (2026-10-10)

**Hecho**
- 4 migraciones (una por `ADD VALUE`): `INCOME_SOURCE`, `OCCUPATION`, `NO_PAYMENT_REASON`, `COLLECTION_MODALITY`.
- `CATALOG_DEFAULTS` en `packages/shared` (la lista completa, movida desde `seed.ts`) y `catalogDefaultRows()`; el seed la importa.
- El registro de cuentas siembra los catálogos (`accounts.service.ts`); backfill `db:backfill:catalogs` (con `--dry`).
- Validación del `metadata` de rubros y motivos (`validateCatalogMetadata`, `reasonsFor`) en `shared` y en la API.
- `update`/`remove` filtran por tipo (corrección de un defecto, D-21).
- Móvil hidrata los 4 tipos; `CatalogOption.metadata` ampliado en móvil y web.

**Verificación**
| Comando | Resultado |
|---|---|
| `@kobrax/shared` build, type-check, test | 364 pruebas, verde |
| `@kobrax/api` type-check, test | 1.548 pruebas, verde |
| `@kobrax/api` integración `catalogs-signup.it.ts` (base desde cero) | 10 de 10 |
| `@kobrax/web` type-check, test | 938 pruebas, verde |
| `@kobrax/mobile` type-check, test | 916 pruebas, verde |
| Migraciones en la base local | Aplicadas; backfill: 30 por cuenta, 0 en la segunda corrida |

**Queda**: editor de estos catálogos en `/cuenta` (hoy se editan por API); no bloquea E2–E4.

**Por validar en teléfono**: que los catálogos nuevos aparezcan sin red tras una hidratación.

### E2 · Perfil de cobro ✅ (2026-10-10)

**Hecho**
- `collection-profile.ts` en `shared`: esquema (`modality`, `frequency`, `window`, `days`, `handoverBy`, `note`), `validateCollectionProfile`
  estricto y conversión formulario ↔ perfil tolerante.
- `LocationRow.collection`, `ClienteForm.preferredContactChannel`, payload, hidratación y diff.
- **API**: `UpdateLocationDto` acepta `visitSchedule` y `riskLevel`; el alta atómica **ya no los descarta**; `updateLocation` los
  persiste (`null` borra); `serializeLocation` los devuelve; validación antes de abrir la transacción;
  `preferredContactChannel` con tope de largo.
- **Web**: bloque «Cómo cobrarle» por ubicación y canal preferido en identificación; resumen en la lista de direcciones.
- **Móvil**: `CollectionBlock` en el formulario de cliente, canal preferido, y el resumen en la ficha vía `/agenda/client-context`.

**Verificación**
| Comando | Resultado |
|---|---|
| `@kobrax/shared` build, type-check, test | 386 pruebas, verde |
| `@kobrax/api` type-check, test | 1.556 pruebas, verde |
| `@kobrax/api` integración `client-collection-profile.it.ts` (base desde cero) | 8 de 8 |
| `@kobrax/web` type-check, test | 947 pruebas, verde |
| `@kobrax/mobile` type-check, test | 926 pruebas, verde |

**Queda**: la agenda no usa todavía la franja ni los días (es la capa B); el perfil de garantes no se edita (D-28).

**Por validar en teléfono**: el bloque «Cómo cobrarle» en el alta y la edición, y que la línea aparezca en la ficha del cliente.

### E3 · Perfil de ingreso ✅ (2026-10-10)

**Hecho**
- **Base**: tabla `client_income_profiles` (una fila por cliente), enums `income_cycle` y `data_origin`, `CHECK` de día y ciclo,
  RLS forzada (inline en la migración y en `001_enable_rls.sql`).
- **Shared**: `income-profile.ts` (validación estricta; formulario ↔ perfil tolerante), `ClienteForm.income`,
  `NewClientInput.incomeProfile`, `ClientDetail.incomeProfile` y `ClienteOps.income` (valor fijo en el diff).
- **API**: `GET`/`PUT /clients/:id/income-profile` (idempotente; cuerpo vacío borra), perfil incluido en el detalle y en el
  alta atómica, auditoría de crear/editar/borrar sin repetir en reintentos.
- **Web**: acordeón en el alta, sección editable en la ficha, resumen, rubro filtrado por fuente y propuestas del rubro.
- **Móvil**: bloque en el formulario, `client.income` en la cola offline, resumen en la ficha.

**Verificación**
| Comando | Resultado |
|---|---|
| `@kobrax/shared` build, type-check, test | 411 pruebas, verde |
| `@kobrax/api` type-check, test | 1.567 pruebas, verde |
| `@kobrax/api` integración `client-income-profile.it.ts` (base desde cero, RLS, CHECK) | 11 de 11 |
| `@kobrax/web` type-check, test | 962 pruebas, verde |
| `@kobrax/mobile` type-check, test | 944 pruebas, verde |

**Queda**: la capa B todavía no usa el ciclo (fecha de promesa sugerida); el perfil por **crédito** (S2) se difiere.

**Por validar en teléfono**: el bloque «Perfil de ingreso» en alta y edición, que el cambio sin señal se sincronice, y que la
ficha muestre «Ingreso».

### E4 · Motivo de no pago en la gestión ✅ (2026-10-10)

**Hecho**
- **Base**: columnas **nulables** `reason_code`, `expected_income_date`, `payer_party` y `origin` en `credit_activities`, el tipo
  `payer_party` y un índice por motivo y fecha. La tabla es append-only: no se reescribió ninguna fila.
- **Shared**: `validateActivityContext` (regla única, opcional, con su `isRealDay`), `PayerParty`, nuevos códigos de error.
- **API**: `POST /mora/:id/activities` y `POST /agenda/:id/complete` aceptan el contexto; la ficha lo devuelve; se
  audita sin el texto libre.
- **Web**: bloque «Motivo y quién responde» en el formulario de gestión, filtrado por la fuente de ingreso del cliente,
  con la fecha solo cuando el motivo la pide.
- **Móvil**: `ReasonBlock` compartido por la hoja de gestión y el registro de la agenda; `agenda.complete` en la cola
  lleva los campos nuevos y una acción antigua sale igual.

**Verificación**
| Comando | Resultado |
|---|---|
| `@kobrax/shared` build, type-check, test | 419 pruebas, verde |
| `@kobrax/api` type-check, test | 1.580 pruebas, verde |
| `@kobrax/api` integración **completa** (9 archivos, base desde cero) | **92 de 92**, incluidas las anteriores a esta capa |
| `@kobrax/web` type-check, test | 971 pruebas, verde |
| `@kobrax/mobile` type-check, test | 958 pruebas, verde |

**Queda**: la web de completar una gestión **agendada** y el registro de la **visita de ruta** (D-48); el dictado que llene el
motivo (capa C).

**Por validar en teléfono**: el bloque de motivo en la hoja de gestión y al completar una gestión de la agenda, y que una
gestión registrada sin señal suba con su motivo.

### E5 · Plantilla usada ✅ (2026-10-10)

**Hecho**: columna nulable `template_code` en `credit_activities`; regla compartida (solo un mensaje, formato de código);
`POST /mora/:id/activities` y `POST /agenda/:id/complete` la aceptan; la ficha la devuelve; el móvil la registra al elegir una
plantilla en la hoja de WhatsApp y viaja por la cola (una acción anterior sale igual). El nombre dice **elegida**: `wa.me` no
confirma el envío (D-05).

**Verificación**: shared 423 pruebas; API integración `activity-context` 15 de 15.

**Queda**: la web no ofrece plantillas al completar una gestión (D-51).

### E6 · Importación (verificación) ✅ (2026-10-10)

**Resultado: no existe.** El catálogo de campos de la importación (`apps/api/src/modules/imports/field-catalog.ts`) no tiene
rubro, ciclo ni tipo de crédito, y `typeCode` no se mapea. Lo único cercano es «negocio / dirección del negocio»
(`businessAddress`), una señal indirecta de que el cliente es comerciante. Si se quiere, es un plan aparte (A5): agregar
`occupation` y `creditType` como campos opcionales, con su regla de columnas en `FIELD-RULES`.

### Seeds ✅ (2026-10-10)

La lista de catálogos del seed ahora sale de `CATALOG_DEFAULTS` (la misma que el registro). Las cuentas DEMO traen
perfiles de ingreso (funcionario trimestral, transportista semanal, profesional mensual, comerciante diario), el perfil de
cobro «en el negocio, todos los días» en los lugares con negocio, y seis gestiones con motivo, quién responde y plantilla.
Validado **en una base nueva** por una prueba de integración. **No se ejecutó `db:seed:refresh` en la base local** (D-54).

### Resumen de la capa A

| Etapa | Estado |
|---|---|
| E1 · Catálogos y siembra | ✅ |
| E2 · Perfil de cobro | ✅ |
| E3 · Perfil de ingreso | ✅ |
| E4 · Motivo en la gestión | ✅ |
| E5 · Plantilla usada | ✅ |
| E6 · Importación | ✅ verificada (no existe; plan aparte) |

**Verificación final**: shared 423 · API 1.583 unitarias + **99 de integración** (9 archivos, base desde cero) · web 971 · móvil 959 pruebas, todas en verde.

## 11. Validación del plan (gate `/f10-validar-plan`, adaptado — D-10)

El gate está escrito para etapas móviles F10. Se aplicó con sus ítems de calidad y con los de completitud que
corresponden; los específicos de F10 (Figma, rama `f10/PN`, build 🟢/🔵, economía de tokens de Figma) no aplican.

**Primera pasada (2026-10-10): FAIL.** Bloqueantes encontrados y su corrección:

| Ítem | Hallazgo | Corrección |
|---|---|---|
| 5 Contrato | No definía cuerpo ni respuesta de los endpoints nuevos | Agregado §1.3 |
| 6 Auditoría de reuso | No existía la tabla REUSAR / EXTENDER / NUEVO | Agregado §1.1 |
| 7 Artefactos nuevos | Sin justificación ni ubicación | Agregado §1.2 |
| 9 Reglas de la fase | No estaban escritas | Agregado §1.4 |
| 10 DoD verificable | Sin comandos | Reescrito §4 |
| 16 Preguntas pendientes | S1–S4 sin respuesta registrada | Confirmadas; ver §0.2 y registro de decisiones |
| 14 No negociables | Offline y `{data,meta,error}` no se declaraban | Explícitos en §1.3 y §1.4 |

**Segunda pasada: PASS.** Ítems aplicables 1, 5–16 cumplidos. Advertencias (no bloquean):

- E4 deja fuera la visita de ruta (D-11); debe retomarse en un plan posterior o los historiales quedarán con campos vacíos según el origen.
- La lista de motivos y rubros es un borrador pendiente de validar con cobradores; cada cuenta puede ajustarla.
