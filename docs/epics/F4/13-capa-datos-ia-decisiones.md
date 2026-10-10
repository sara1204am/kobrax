# F4/13 · Registro de decisiones de la capa de datos para la IA

Complementa [`13-capa-datos-ia-plan.md`](./13-capa-datos-ia-plan.md). Aquí se anota **cada decisión** que se toma
durante la implementación, con su motivo, las alternativas y quién la tomó. Se agrega al final; no se reescribe.

**Quién decide.** Las marcadas «fundadora» las confirmó ella. Las marcadas «delegada» las tomó Claude por delegación
expresa de la fundadora el 2026-10-10 («decide tú lo mejor para la app y cada decisión guárdala»); son revisables.

| Campo | Significado |
|---|---|
| **Estado** | Vigente · Reemplazada · Revisar |
| **Reversible** | Si se puede deshacer sin migrar datos |

---

## Decisiones de partida

| # | Fecha | Decisión | Motivo | Alternativas descartadas | Quién | Reversible |
|---|---|---|---|---|---|---|
| D-01 | 2026-10-10 | **Los catálogos por defecto se siembran al registrar una cuenta** y se hace backfill de las existentes (S1) | Verificado: el registro no siembra catálogos; una cuenta nueva nacería sin motivos ni rubros y la capa no serviría | Sembrar solo bajo demanda; dejar vacío y que cada cuenta cargue los suyos | Fundadora | Sí |
| D-02 | 2026-10-10 | **El perfil de ingreso es del cliente** (S2), con sobrescritura por crédito a futuro | Un cliente es una persona con una fuente de ingreso; lo contrario complica la captura | Perfil por crédito desde el inicio | Fundadora | Sí (columna nueva después) |
| D-03 | 2026-10-10 | **El motivo de no pago es opcional** (S3) | La cola offline puede traer gestiones antiguas; hacerlo obligatorio las rechazaría con 400 y se perdería trabajo de campo | Obligatorio cuando no hay pago | Fundadora | Sí |
| D-04 | 2026-10-10 | **El catálogo `ZONE` queda fuera** (S4) | `zone` es texto libre; normalizarlo exige decidir geocodificación, que no existe en el repo | Incluirlo con valores libres | Fundadora | Sí |
| D-05 | 2026-10-10 | `template_code` significa **plantilla elegida**, no enviada (S5) | `wa.me` no confirma el envío; llamarlo «enviada» sería falso | Nombrar el campo `sent_template` | Delegada | Sí |
| D-06 | 2026-10-10 | **No se sube `QUEUE_VERSION`** (S6) | Los campos nuevos son opcionales; subirla marcaría ítems antiguos como no soportados y los haría descartables | Subir a 2 | Delegada | Sí |
| D-07 | 2026-10-10 | **Sin permisos nuevos**: se reutilizan `catalog:write`, `client:write`, `collection:write` (S7) | Menos superficie; los roles ya existen | `ai:use` desde ya | Delegada | Sí |
| D-08 | 2026-10-10 | **Una sola rama `docs/ia-capa-datos`** desde `dev`, con un commit por etapa; push a esa rama; **sin PR ni merge** | Pedido de la fundadora; el merge exige su frase exacta | Rama por etapa | Fundadora | Sí |
| D-09 | 2026-10-10 | **Las listas por defecto de catálogos viven en `packages/shared`** (`CATALOG_DEFAULTS`) y las usan el seed y el registro | Una sola fuente; evita que seed y registro diverjan | Duplicar en la API | Delegada | Sí |
| D-10 | 2026-10-10 | **El gate `/f10-validar-plan` se aplica adaptado**: los ítems de Figma y rama `f10/PN` se marcan N/A | El gate es de etapas móviles F10; este plan toca API, web y móvil sin Figma | Omitir el gate | Delegada | — |

## Decisiones tomadas por delegación durante el diseño

| # | Fecha | Decisión | Motivo | Alternativas descartadas | Quién | Reversible |
|---|---|---|---|---|---|---|
| D-11 | 2026-10-10 | **El motivo en la visita de ruta queda fuera de E4**; E4 cubre mora y completar una gestión de agenda | `field.service.ts` usa otra API y otro formulario; mezclarlo duplicaría el riesgo en la etapa más delicada | Cubrir los tres escritores | Delegada | Sí |
| D-12 | 2026-10-10 | **«Quién responde» entra como `payer_party`** (enum), **sin selector de relación** en la interfaz; `payer_relation_id` existe en la base pero no se expone todavía | El id de una relación local aún no sincronizada no se resolvería en la cola (`resolveLocalIds` solo traduce contactos y ubicaciones de agenda) | Exponer ambos | Delegada | Sí |
| D-13 | 2026-10-10 | **Se audita la actividad** con motivo, origen y quién responde, **sin texto libre** | `addActivity` hoy no audita; sin rastro no se puede explicar un dato aprendido. El texto libre puede traer datos personales | No auditar; auditar todo | Delegada | Sí |
| D-14 | 2026-10-10 | **`preferredContactChannel` no se restringe a una lista**; se acota solo la longitud, y la interfaz ofrece valores conocidos conservando cualquier otro ya guardado | Los datos existentes usan `PHONE`; restringir podría invalidar registros | Lista cerrada | Delegada | Sí |
| D-15 | 2026-10-10 | **El perfil de ingreso va en tabla propia** (`client_income_profiles`), no en `clients.metadata` | `metadata` ya guarda `linkSuggestions` y `update` lo reemplaza entero, sin mezclar | Reutilizar `metadata` | Delegada | Sí |
| D-16 | 2026-10-10 | **El perfil de cobro se guarda en `client_locations.visit_schedule`** con esquema validado en `shared` | El campo ya existe y no exige migración; el cobro es por lugar (negocio ≠ domicilio) | Columnas nuevas en `clients` | Delegada | Sí |
| D-17 | 2026-10-10 | **Un `ADD VALUE` por migración** | Restricción de PostgreSQL con transacciones de Prisma; patrón ya usado en el repo | Una migración con los cuatro | Delegada | — |

## Decisiones durante la implementación

_(se agregan abajo, con su número siguiente)_

| # | Fecha | Etapa | Decisión | Motivo | Alternativas descartadas | Quién | Reversible |
|---|---|---|---|---|---|---|---|
| D-18 | 2026-10-10 | E1 | `NO_PAYMENT_REASON.HEALTH_OR_BEREAVEMENT` **coexiste** con `SPECIAL_CATEGORY` (fallecimiento, enfermedad grave) | Son cosas distintas: la categoría especial es una gestión de campo (RT-6); el motivo explica por qué no pagó. Se marca `sensitive` | Reutilizar `SPECIAL_CATEGORY` como motivo | Delegada | Sí |
| D-19 | 2026-10-10 | E1 | El registro siembra **todos** los catálogos por defecto (incluidos métodos de pago y bancos), no solo los nuevos | Verificado: una cuenta registrada no podía registrar un pago por falta de métodos. Es una corrección además de la capa de datos. Los bancos son de Bolivia (`DEFAULT_COUNTRY = BO`); revisar si se abre a otros países | Sembrar solo los 4 nuevos | Delegada | Sí |
| D-20 | 2026-10-10 | E1 | Los códigos de `INCOME_SOURCE` (`EMPLOYEE`, `BUSINESS`, `OTHER`) son **fijos**; solo el rótulo se edita | `NO_PAYMENT_REASON.metadata.appliesTo` filtra por ese código; si se editara, los motivos dejarían de filtrarse | Códigos libres | Delegada | Sí |
| D-21 | 2026-10-10 | E1 | `update` y `remove` de catálogos **filtran por tipo además del id** | Era un defecto: `PATCH /catalogs/BANK/<id de un motivo>` modificaba el ítem de otro tipo. Cubierto con prueba unitaria y de integración | Dejarlo (fuera de alcance) | Delegada | — |
| D-22 | 2026-10-10 | E1 | El `metadata` solo se valida para `OCCUPATION` y `NO_PAYMENT_REASON`; los demás tipos siguen aceptando cualquier objeto | No romper plantillas de WhatsApp y métodos de pago existentes | Validar todos | Delegada | Sí |
| D-23 | 2026-10-10 | E1 | El **backfill es un script** (`db:backfill:catalogs`, con `--dry`) y no una migración de datos | Las migraciones no deben depender de datos de cada entorno; el script es repetible y verificable en simulacro | Migración con `INSERT … SELECT` | Delegada | Sí |
| D-24 | 2026-10-10 | E1 | `prisma generate` falla con `EPERM` al copiar el motor si un servidor de desarrollo lo tiene abierto; **es inocuo** | Los tipos y el esquema embebido sí se regeneran; el motor binario no depende del esquema | Matar el servidor del usuario | Delegada | — |
| D-25 | 2026-10-10 | E1 | La prueba de integración opera con un **gerente** agregado a la cuenta registrada | El dueño registrado es `ACCOUNT_ADMIN` (rol crítico): su primer login exige configurar MFA y enrolar TOTP no es lo que se prueba | Deshabilitar la política de MFA en la prueba | Delegada | — |
| D-26 | 2026-10-10 | E2 | **El perfil de cobro se valida de forma estricta** (campos desconocidos → 400) pero **se lee con tolerancia** | La columna aceptó cualquier objeto hasta hoy; escribir estricto evita que siga siendo un cajón, y leer tolerante evita que abrir la ficha de un cliente antiguo falle | Validar también al leer | Delegada | Sí |
| D-27 | 2026-10-10 | E2 | **Borrar el perfil manda `null`** (en la columna JSON se guarda con `Prisma.DbNull`); una fila nueva sin perfil no manda nada | Distingue «quitar» de «no tocar»; sin esto un perfil borrado en pantalla reaparecía al recargar | Mandar `{}` | Delegada | Sí |
| D-28 | 2026-10-10 | E2 | **El perfil de cobro es solo del cliente, no de los garantes**: la fila de garante lo conserva sin mostrarlo | Cobrarle a un garante es la excepción; evita un formulario más largo. Si ya trae un perfil, ida y vuelta no lo pierde | Mostrarlo también en garantes | Delegada | Sí |
| D-29 | 2026-10-10 | E2 | **`days` usa numeración ISO 1–7 (lunes–domingo)** y `window` exige `from < to` (sin franjas que crucen la medianoche) | Evita la ambigüedad domingo=0/7 de otras librerías. El turno de noche se modela con dos franjas en el futuro si hace falta | 0–6; permitir cruzar medianoche | Delegada | Sí |
| D-30 | 2026-10-10 | E2 | **Las funciones del perfil toleran que falte el campo** (`null`/`undefined` = vacío) | Una prueba existente y cualquier borrador o caché anterior arman filas sin `collection`; guardar no puede romperse por eso | Exigirlo siempre | Delegada | — |
| D-31 | 2026-10-10 | E2 | **Se corrigió el alta atómica**: ahora conserva `visitSchedule` y `riskLevel` | Era un defecto: el DTO los aceptaba y `mkLocation` los descartaba | — | Delegada | — |
| D-32 | 2026-10-10 | E2 | **El perfil viaja también en el contexto de agenda** (`/agenda/client-context`) para las ubicaciones del cliente | Es de donde el móvil arma la ficha de cobranza; sin esto el cobrador no lo vería | Pedirlo aparte | Delegada | Sí |
| D-33 | 2026-10-10 | E3 | **Vaciar el perfil de ingreso borra la fila** (no es borrado lógico); la auditoría guarda el antes | Es un dato derivado y de una sola fila por cliente: un borrado lógico obligaría a manejar «fila borrada» en la clave única y en cada lectura. El historial queda en `audit_logs` | `deleted_at` (regla general de tablas) | Delegada | Sí |
| D-34 | 2026-10-10 | E3 | **El rubro se valida como código pero no se verifica contra el catálogo** | La cuenta puede editar o quitar rubros; una gestión encolada sin señal con un rubro que ya no existe no debe fallar con 400 (se perdería trabajo de campo) | Exigir que exista y activo | Delegada | Sí |
| D-35 | 2026-10-10 | E3 | **`PUT` guarda el estado final** (lo que no viene se limpia) y **responde `{}` si quedó vacío**, no `null` | Es lo que lo hace idempotente y encolable. Un 200 con cuerpo nulo se lee como error en los clientes (`apiMutate` del móvil), así que `{}` | Parche parcial; `204` | Delegada | Sí |
| D-36 | 2026-10-10 | E3 | **El día solo existe con ciclo semanal (1–7) o mensual y trimestral (1–31)**; en los demás ciclos no hay día. Además un `CHECK` en la base lo respalda | «Cada quincena» ya sugiere dos fechas; «por temporada» o «irregular» no tienen día. Defensa en profundidad: aunque se saltee la API, la base rechaza un día sin ciclo | Aceptar cualquier día | Delegada | Sí |
| D-37 | 2026-10-10 | E3 | **Al elegir un rubro se proponen su fuente y su ciclo, sin pisar lo ya elegido** | Menos toques para quien carga, sin imponer nada: `metadata.incomeSource` y `metadata.defaultCycle` son sugerencias | Autocompletar siempre | Delegada | Sí |
| D-38 | 2026-10-10 | E3 | **En el móvil el perfil es una acción de cola propia** (`client.income`, valor fijo) y **no se sube `QUEUE_VERSION`** | Es idempotente, así que puede encolarse; un `kind` nuevo que una app vieja no conozca ya queda como «no soportado» y visible | Online-only | Delegada | Sí |
| D-39 | 2026-10-10 | E3 | **El alta lleva el perfil en el mismo `POST /clients`** (atómico) | El alta offline del móvil ya viaja entera por la cola; así no hace falta un segundo paso que pueda fallar a medias | Un PUT posterior | Delegada | Sí |
