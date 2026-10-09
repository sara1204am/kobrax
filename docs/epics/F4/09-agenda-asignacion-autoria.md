# F4/09 · Agenda: asignar a un cobrador, «Asignada por» y edición solo del creador

Estado: **implementado** en API, web y móvil (2026-10-06), sin commitear. Ver «Lo que quedó distinto» al final.
El plan se armó leyendo el código; cada afirmación de «hoy» está verificada contra el archivo que se cita.

## 1. Reglas de negocio (lo acordado)

| # | Regla |
|---|---|
| R1 | **Cobrador:** agenda gestiones para sí mismo. No puede asignarlas a otro (403 si lo intenta). |
| R2 | **Supervisor, gerente, administrador** (quien tiene `agenda:assign`): agenda para sí o **asigna a un cobrador** de su alcance. |
| R3 | Esos mismos roles **ven la agenda de su equipo**. |
| R4 | Si la gestión la creó alguien distinto del responsable, se muestra **«Asignada por X»** (web y móvil). |
| R5 | **Editar y eliminar: solo quien creó la gestión.** El administrador y el gerente **no** tocan lo que no crearon. |
| R6 | Las gestiones viejas son del seed: se corrige el seed para que cada una tenga creador coherente. No hay datos reales anteriores que migrar. |

Lo que **no** cambia: completar, posponer, cancelar y reagendar siguen abiertos al responsable (y a su supervisor
con `agenda:assign`, como hoy). El cobrador tiene que poder ejecutar lo que le asignaron.

## 2. Qué hay hoy (verificado)

- `agenda_items.assignee_id` (responsable) y `created_by` (nullable) ya existen: **no hace falta migración**.
  `schema.prisma` · `model AgendaItem`.
- Permiso `agenda:assign` lo tienen `SUPERVISOR`, `MANAGER` y `ACCOUNT_ADMIN` (todos menos el audit);
  `COLLECTOR` no. `packages/shared/src/constants/permissions.ts`.
- **Ver al equipo ya existe** (R3): `assigneeScope()` en `agenda.service.ts:110` — sin `agenda:assign` solo lo propio;
  con él, los créditos a su alcance (supervisor: su agencia; gerente/admin: todo).
- El alta **no deja elegir responsable**: `insertItem` pone `credit.assignedManagerId ?? userId`
  (`agenda.service.ts:679`). `CreateAgendaItemDto` no tiene `assigneeId`.
- `update` (`PATCH /agenda/:id`) y `remove` (`DELETE /agenda/:id`) existen y solo operan sobre `SCHEDULED`; el único
  filtro es `assigneeScope` — **no miran `createdBy`**.
- El móvil **ya edita y elimina** (`app/agenda/[id].tsx`, menú ⋯: `updateItem`/`deleteItem`). La web no tiene ni
  botones ni rutas BFF (`api/agenda/[id]/` solo tiene `cancel`, `complete`, `reschedule`).
- El serializador no devuelve `createdBy` (`agenda.serializer.ts:26`); `AgendaListItem` tampoco lo tiene.

## 3. Trampas encontradas (por qué hay que ir con cuidado)

1. **`reschedule` pisa al creador.** Crea una fila nueva con `createdBy: this.tenant.userId`
   (`agenda.service.ts:840`). Si un cobrador reagenda lo que le asignó su gerente, pasa a ser «creador» y podría
   editarla y eliminarla: rompe R5, y además borra el «Asignada por». **Hay que copiar `createdBy` del original.**
2. **`GET /users` no sirve para elegir a quién asignar.** Pide `user:read` y el supervisor no lo tiene
   (`web/.../agenda/page.tsx:42-48`: ya hoy devuelve 403 y la supervisora ve la agenda sin agrupar). Hace falta un
   endpoint propio, `GET /agenda/assignees`, protegido por `agenda:assign`. De paso arregla el agrupado del equipo.
3. **Promesas registradas desde Mora** (`createPromiseItem`, `agenda.service.ts:631`) asignan al responsable del
   crédito y guardan `createdBy` = quien registra. Si no son la misma persona, saldrá «Asignada por X». Es verdad
   (X la creó para otro), así que se acepta; la etiqueta dice «Asignada por», no «Creada por».
4. **El recordatorio automático de la promesa** hereda `createdBy` de quien creó la promesa: queda del mismo
   creador, que es lo correcto (R5 aplica igual).
5. **Cola offline del móvil:** editar/eliminar encolados sin red pueden volver 403 al sincronizar. El móvil debe
   ocultar los botones cuando no es el creador **y** tratar el 403 como error normal, no reintentar.
6. **`createdBy` nulo:** con la regla estricta nadie edita ni elimina esa fila. Hoy solo ocurre con filas escritas
   fuera de la API; el seed se corrige (R6). Se deja estricto a propósito.
7. Casi todos los tests de `agenda.service.spec.ts` usan un `tenant` simulado: los de `update`/`remove` hay que
   revisarlos, porque hoy asumen que cualquiera dentro del alcance puede editar.

## 4. Diseño

### 4.1 API (`apps/api/src/modules/agenda`)

1. **Alta con responsable.** `CreateAgendaItemDto.assigneeId?: string` (`@IsOptional @IsUUID`).
   En `createOnce`:
   - sin `assigneeId` → igual que hoy;
   - con `assigneeId` igual al propio → igual que hoy;
   - con otro y **sin** `agenda:assign` → 403 `agendaAssignForbidden`;
   - con otro y con `agenda:assign` → valida que sea un **cobrador activo de su alcance** (supervisor: su agencia;
     gerente/admin: la cuenta). Si no → 404/422 con el mismo estilo que `agendaCreditNotFound`.
   - Un `assigneeId` explícito **gana** sobre `credit.assignedManagerId`.
   `insertItem` recibe el `assigneeId` ya resuelto en vez de calcularlo adentro.
2. **`GET /agenda/assignees`** (`@Roles(AGENDA_ASSIGN)`): `{ userId, name, branchId? }[]`, solo nombre y apellido
   (nunca el correo), mismo alcance que el punto anterior. Lo usan el selector del modal y el agrupado del equipo.
3. **Autoría en `update` y `remove`:** además de `assigneeScope`, exigir `item.createdBy === tenant.userId`;
   si no → 403 `agendaNotOwner` (mensaje claro: «Solo quien creó la gestión puede editarla/eliminarla»). Sin excepción
   para administrador. Va **después** del 404 por alcance (no revelar existencia).
4. **`reschedule`:** `createdBy: item.createdBy` (copiar), no el usuario actual. `updatedBy` sigue siendo quien reagenda.
5. **Serializador y contrato:** agregar `createdBy`, `createdByName` y `assignedByName` (este último solo cuando
   `createdBy` existe y es distinto de `assigneeId`). Nombres vía `loadNames`, ya usado para `assigneeName`.
   Mismo cambio en `packages/shared/src/types/agenda.types.ts` (`AgendaListItem`), con comentario de que no hay correo.
6. **Auditoría:** `CREATE` ya guarda el registro completo (incluye `assigneeId`); no se agrega nada.
   El 403 de autoría queda en el log normal de errores.

### 4.2 Web (`apps/web`)

1. **Modal «Nueva gestión»:** selector **«Asignar a»** (por defecto «Yo»), visible solo si el usuario tiene
   `agenda:assign` (ya se lee de `/auth/me`). Opciones desde `GET /agenda/assignees` vía un handler BFF nuevo.
2. **Rutas BFF** `api/agenda/[id]/route.ts`: `PATCH` y `DELETE`, ambas con `sameOrigin()`, igual que `cancel`.
3. **Detalle (`agenda/[id]`):** botones **Editar** y **Eliminar** (confirmación, con la misma advertencia del móvil:
   «Para dejar constancia de que no se hizo, cancela»), visibles solo si `item.createdBy === me.id` **y** la
   gestión está pendiente. Editar reutiliza el formulario del modal: deudor/crédito y fecha de solo lectura (cambiar
   el día es reagendar), tipo, campos propios, hora y observaciones editables.
4. **«Asignada por X»:** línea en el detalle y en la fila (`agenda-row.tsx`) cuando venga `assignedByName`.
   Textos nuevos en `es.json` y `en.json` (el test de i18n falla si falta uno).
5. **Agrupado por equipo:** `page.tsx` pasa a usar `/agenda/assignees` en lugar de `/users` para `members`.

### 4.3 Móvil (`apps/mobile`)

1. Mostrar **«Asignada por X»** en el detalle y en la fila de la agenda.
2. En el menú ⋯ del detalle, ocultar **Editar** y **Eliminar** si `item.createdBy` no es el usuario de la sesión;
   dejar Reagendar y Cancelar. Manejar el 403 sin reintentos (cola offline).
3. El **alta del cobrador no cambia** (nunca manda `assigneeId`); si el móvil de un supervisor crea gestiones, queda
   para una segunda etapa (no se pidió).

### 4.4 Seed (`packages/database/prisma/seed.ts`)

- `addItem` hoy escribe `createdBy: assigneeId` (línea ~907): todo parece auto-creado. Pasar a un campo
  `createdBy` opcional en `ItemOpts` (por defecto, el responsable, como hoy).
- Sembrar **casos reales de asignación**: varias gestiones de la semana siguiente creadas por `sandra` (supervisora CEN)
  y `maria` (ALT) para sus cobradores, y una creada por el gerente para un cobrador de otra agencia.
- Las rutas nuevas y el resto del seed no se tocan. Se corre con `pnpm db:seed:refresh` (borra y recrea el demo).

## 5. Orden de trabajo

1. API: DTO + validación del responsable + `GET /agenda/assignees` + autoría + `reschedule` + serializador + shared.
2. Tests de API (casos de la sección 6).
3. Seed.
4. Web: selector, rutas BFF, botones y modal de edición, «Asignada por», `members`.
5. Móvil: «Asignada por» y ocultar botones.
6. `type-check` de api/web/mobile/shared, suites de agenda, y prueba manual con el seed refrescado.

## 6. Pruebas

**API** (`agenda.service.spec.ts`, nuevos):
- cobrador manda `assigneeId` ajeno → 403; con el propio → pasa.
- supervisor asigna a cobrador de su agencia → ok; de otra agencia → rechazado.
- gerente/admin asigna a cualquiera de la cuenta; a un usuario que no es cobrador o está inactivo → rechazado.
- `assigneeId` explícito gana sobre `assignedManagerId`.
- `update`/`remove` por quien no creó → 403, **también administrador**; por el creador → ok.
- `reschedule` conserva `createdBy` y el reagendador no pasa a poder editar.
- serializador: `assignedByName` solo si creador ≠ responsable; nunca correo.
- `GET /agenda/assignees`: 403 sin `agenda:assign`; alcance por rol.

**Web** (Vitest): selector oculto sin `agenda:assign`; botones Editar/Eliminar solo para el creador y solo pendiente;
«Asignada por» aparece/no aparece; mensajes es/en.

**Móvil:** ocultar Editar/Eliminar cuando no es el creador; mostrar «Asignada por».

## 7. Fuera de alcance (no se pidió)

- Reasignar una gestión ya creada a otro cobrador.
- Que el supervisor cree gestiones para otros desde el móvil.
- Notificar al cobrador cuando le asignan algo (hoy no hay ese aviso en la agenda).

## 8. Lo que quedó distinto del plan

- **A quién se asigna:** se reutilizó la regla que ya reparte la cartera (`assignment-rules.ts`): cobradores y
  supervisores activos, o uno mismo; el supervisor solo dentro de su agencia. Gerentes y administradores no son destino.
- **Serializador:** solo `createdBy` y `assignedByName` (no hizo falta `createdByName`). El historial del detalle ahora
  trae hora, observaciones y `details` de cada gestión.
- **Detalle web rediseñado** según `dettale recordatorio.png`: tarjeta azul del crédito (la de la ficha de cartera),
  tarjeta «Detalle de la gestión» y línea de tiempo con la gestión actual resaltada.
- **Móvil:** «Asignada por X» en el detalle y Editar/Eliminar ocultos si no es el creador. **Falta** el «Asignada por»
  en la fila de la lista de agenda.
- **Seed:** 4 gestiones asignadas (Sandra→Rosa y Marco, María→Julia, Mónica→Julia). Para verlas hay que correr
  `pnpm db:seed:refresh`.
