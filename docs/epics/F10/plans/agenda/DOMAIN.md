# Agenda — Modelo de dominio (VISIÓN objetivo)

> Captura completa de la spec de "crear gestión agendada". **Es el objetivo**, se construye **por capas**
> (ver README §fases). No todo entra en la primera versión — acá queda todo para no perderlo.

## Núcleo común (toda gestión lo tiene → se guarda UNA vez)
- **Tipo de gestión** (obligatorio, único, inmutable tras ejecutar): CALL · VISIT · WHATSAPP · REMINDER · PROMISE_TO_PAY.
- **Cliente** (obligatorio, del tenant, activo, único). Buscador + autocomplete + tarjeta (nombre, CI, tipo).
  Al buscar mostrar **nombre + monto del préstamo + saldo**. Al elegir → cargar teléfonos, direcciones, créditos, saldo, promesas activas.
- **Crédito** (un cliente puede tener varios → **elegir cuál**; trae saldo).
- **Observaciones** (opcional, multilínea, máx configurable, emojis).
- **Programación** (fecha + hora, ver abajo).
- **Resultado esperado**: Cobrar · Recordar · Confirmar visita · Confirmar pago · Negociar.
- **Prioridad**: Muy alta · Alta · Media · Baja.
- **Estado**: Pendiente · Programada · Ejecutada · Cancelada · Reagendada · Expirada.
- **Responsable**: gestor / supervisor / equipo (default = cobrador actual).
- **Canal** (aunque el tipo lo insinúa): saliente/entrante, WhatsApp, SMS, correo.
- **Campaña** (opcional pero importante).
- **Adjuntos** (fotos, PDF, comprobantes, audios) — reusa storage de evidencias (F10 P8).
- **Auditoría** de creación y modificación. Soft-delete.

## Programación (común)
- **Fecha**: calendario, obligatoria, no pasado (configurable por permiso).
- **Hora**, con **modo**: `FIXED` (08:30) · `LAPSE` (Mañana/Tarde/Noche) · `RANGE` (08:00–10:00).

## Campos específicos por tipo
- **Llamada**: teléfono (**selector** de los del cliente: celular/oficina/casa/referencia + permitir otro; formato válido, internacional) · notas.
- **Visita**: dirección (**selector** de todas las del cliente: casa/trabajo/negocio/otra) · switch "usar otra dirección" → (dirección, ciudad, zona, referencia, GPS opcional) · notas. Evidencias (GPS/foto/firma/hora llegada-salida) = F10 P8.
- **WhatsApp**: teléfono (selector, validar que tenga WhatsApp) · mensaje inicial (con **variables** `{{cliente}}`/`{{saldo}}` y **plantillas**) · notas.
- **Recordatorio**: título · descripción (obligatoria) · prioridad · categoría · notas.
- **Promesa de Pago** (el más complejo): monto prometido (>0, ≤ saldo, moneda correcta, 2 decimales) · fecha de pago (obligatoria, no pasado, límite configurable) · **medio de pago** (catálogo: efectivo/depósito/transferencia/QR/cheque/débito/crédito/pago móvil/caja/agencia/cobrador…) · **banco** (catálogo, solo si el medio lo requiere) · notas · programación del recordatorio.

## Datos del cliente (REUSAN modelos existentes)
- **Teléfonos** → `client_contacts` (ya existe). Si falta → **agregar desde acá** (crea `ClientContact`).
- **Direcciones** → `client_locations` (ya existe). Si falta → agregar desde acá.
- **Créditos / saldo** → `credits` (ya existe, `outstandingBalance`).
- **Medio de pago** → `PaymentMethod` (enum ya existe; ampliar valores faltantes).

## Catálogos (configurables por tenant — capa posterior)
Tipo de gestión · Estado · Resultado · Medio de pago · **Banco** · Tipo de dirección · Prioridad ·
Motivo de cancelación · Motivo de reprogramación · Tipo de recordatorio · Tipo de teléfono · Moneda.
> Los **estables** arrancan como enums en shared; los **por-tenant** (banco, campaña, motivos) se hacen
> tabla de catálogo cuando se necesite configurarlos — no antes.

## Validaciones generales
Cliente obligatorio+activo · tipo obligatorio · fecha+hora obligatorias · usuario autenticado · tenant
válido · permiso para crear gestiones · crédito activo · no duplicar gestión igual misma fecha/hora ·
no programar en el pasado (salvo permiso) · auditoría de creación/modificación.

## Qué REUSA vs qué es NUEVO
- **REUSA**: `clients`, `client_contacts`, `client_locations`, `credits`, `PaymentMethod`, evidencias/S3, audit, RLS.
- **NUEVO**: tabla `agenda_items` (núcleo) + enums estructurales + `catalog_items` (genérica) + campos
  específicos por tipo + plantillas WhatsApp.

## Decisiones de almacenamiento (2026-07-08)
- **Núcleo común** → columnas reales en `agenda_items`.
- **Campos específicos por tipo** → **JSONB `details`** en `agenda_items`, validado por esquema en `packages/shared`
  (uno por tipo). Se normaliza un campo puntual solo si hay que reportarlo.
- **Enums (shared, ramifican código)**: `AgendaItemType` (CALL/VISIT/WHATSAPP/REMINDER/PROMISE_TO_PAY),
  `AgendaItemStatus` (PENDING/SCHEDULED/EXECUTED/CANCELLED/RESCHEDULED; EXPIRED = derivado), `ScheduleTimeMode` (FIXED/LAPSE/RANGE).
- **Catálogos configurables por tenant** → **UNA tabla genérica `catalog_items`**
  `(accountId, catalog: CatalogType, code, label, sortOrder, isActive, metadata jsonb)` con
  `@@unique(accountId, catalog, code)`. Cubre los 11 (banco, medio de pago, resultado, prioridad,
  tipo dirección, tipo teléfono, motivo cancelación, motivo reprogramación, categoría recordatorio,
  campaña, moneda). `metadata` p.ej. `{requiresBank:true}` en un medio de pago. Endpoints:
  `GET /catalogs/:catalog` (lee activos del tenant) + ABM `POST/PATCH/DELETE` (permiso). **Seed** de
  defaults por tenant. El **ABM visual** (pantalla de configuración) = capa posterior, no ahora.
