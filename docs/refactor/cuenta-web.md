# Refactor de Cuenta (web) — inventario y propuestas

> **Fecha:** 2026-10-21 · **Rama:** `feat/cuenta-refactor` (desde `dev` en `c6f0293`)
> **Cómo se verificó:** lectura de código en `apps/web/src/app/(panel)/cuenta`, `settings`, `apps/api/src/modules/accounts`, `packages/shared` y el modelo `Account` de Prisma, más `docs/producto/equipo-cuenta-exportacion-y-mercados.md` (2026-10-13). **No se recorrió cada pantalla en el navegador.**
> **Convención:** ✅ existe · 🟡 existe con límite · — no existe.
> Las propuestas son un punto de partida para decidir alcance; ninguna está aprobada.

---

## 1. Qué es hoy «Cuenta»

Hay **tres lugares** distintos y sin relación visual entre sí:

| Ruta | Qué es | Permiso |
|---|---|---|
| `/cuenta` | El **negocio**: plan, datos, configuración financiera, categorías de mora, plantillas de WhatsApp | `account:read` (la ruta del menú) |
| `/settings/perfil` | **Mi perfil** (persona, no negocio) | sesión |
| `/settings/security` | **Seguridad** de la persona: contraseña, MFA, sesiones | sesión |

`/equipo` (miembros) es un cuarto lugar, ya rediseñado en `feat/equipo-ficha-miembro`; se menciona solo para no duplicarlo.

---

## 2. Inventario de `/cuenta`

Orden de arriba hacia abajo (`page.tsx`). Cada bloque se dibuja solo si el rol puede leer su dato.

| # | Sección | Archivo | Qué hace | Editable | Permiso |
|---|---|---|---|:-:|---|
| 0 | Encabezado + estado | `page.tsx` | Título y insignia de estado (Activa, Prueba, Suspendida, Inactiva, Cancelada) | — | `account:read` |
| 1 | **Plan** | `plan-card.tsx` | Nombre y precio del plan; medidores con barra de **personas, créditos, clientes, fotos/mes, gestiones/mes**; «se reinicia el 1»; conservación de fotos; soporte; línea de ajuste a medida; aviso de upgrade | Solo lectura | `account:read` |
| 2 | **Datos del negocio** | `business-form.tsx` | Razón social, NIT, zona horaria (lista de América + botón «detectar») y enlace a Mi perfil | ✅ | `account:write` |
| 3 | **Configuración financiera** | `business-form.tsx` | País, decimales de montos (0–2, con ejemplo), método de conteo de mora por defecto. La moneda se deriva del país | ✅ | `account:write` |
| 4 | **Categorías de mora** | `arrear-categories.tsx` | Tabla código / nombre / desde / hasta / color; agregar y quitar filas | ✅ | `collection:read` para ver; escritura por permiso en la API |
| 5 | **Plantillas de WhatsApp** | `whatsapp-templates.tsx` | Alta y edición de plantillas con tono (suave, media, firme) y variables que el móvil resuelve | ✅ | `catalog:read` / `catalog:write` |

### 2.1 API detrás

| Endpoint | Uso |
|---|---|
| `POST /accounts` | Registro público (10/hora por IP) |
| `GET /accounts/me` | Cuenta con límites y consumo ya resueltos |
| `PATCH /accounts/me` | Solo `businessName, taxId, countryCode, currencyCode, timezone, currencyDecimals, arrearsMethod`. `planCode`, `limitsOverride`, `accountType` y `status` están **fuera a propósito** (el DTO rechaza con 400) |
| `GET/POST/PATCH /catalogs/:catalog` | Plantillas y demás catálogos |
| `/arrear-categories` | Categorías de mora |
| `POST /api/account/upload` (BFF) | Subida de archivos (hoy foto y QR de pago del perfil) |

### 2.2 Modelo de datos (`Account`)

Campos: `businessName, taxId, accountType, status, planCode, limitsOverride (json), countryCode, currencyCode, timezone, settings (json), configuration (json)`.
`settings` guarda `currencyDecimals` y `arrearsMethod`. **`configuration` existe pero no se usa en la pantalla** (candidato natural para nuevas preferencias).

---

## 3. Inventario de Mi perfil y Seguridad

### `/settings/perfil`
- ✅ Nombre, apellido, teléfono (con validación), foto (subida), **QR de cobro** (subida y visor). Correo fijo, no editable. Envía solo el diff.
- — Idioma, preferencias de notificación, firma de mensajes.

### `/settings/security` (hub con `SecurityOptions`)
- ✅ Cambiar contraseña (política validada en servidor).
- ✅ MFA TOTP: activar, desactivar, regenerar códigos de respaldo. Obligatorio para administrador y super admin (`MFA_CRITICAL_GRACE_UNTIL` permite período de gracia).
- ✅ Sesiones activas: listar, cerrar una y cerrar todas.
- 🟡 Multi-cuenta: existe `GET /auth/accounts` y `switch-account`; el cambio de cuenta vive en el login/selector, no en esta sección.

---

## 4. Brechas detectadas

Lo que hoy **no** hay, ordenado por impacto percibido:

| # | Brecha | Evidencia |
|---|---|---|
| B1 | **Sin identidad visual del negocio**: no hay logo ni color; el modelo no tiene campo | `Account` sin `logo`; `upload` solo sirve al perfil |
| B2 | **Datos de contacto del negocio ausentes**: dirección, teléfono, correo, sitio web, ciudad | No están en `Account` ni en el DTO |
| B3 | **Plan opaco**: no se ve fecha de fin de prueba, ni próxima renovación, ni historial; el cambio de plan lo hace Kobrax por línea de comandos | `plan-card.tsx` solo pinta topes; `plan:set` es CLI |
| B4 | **Sin facturación**: no hay datos de facturación, facturas ni método de pago; el nav ya prevé `/cuenta/facturacion` (comentario en `nav.ts`) | Sin código |
| B5 | **Catálogos sin editor completo**: motivos de no pago, rubros, medios de pago, bancos solo se editan por API | Doc de producto §4.1 (🟡) |
| B6 | **Sucursales / agencias sin API ni pantalla**: el modelo existe, solo el seed las crea | Doc de producto §2.4 |
| B7 | **Página larga y plana**: cinco bloques apilados sin navegación interna; todos los roles ven el mismo orden | `page.tsx` |
| B8 | **Guardado por formulario aislado**: cada sección guarda aparte; no hay aviso de cambios sin guardar entre secciones | `business-form`, `arrear-categories`, `whatsapp-templates` independientes |
| B9 | **Sin auditoría visible**: toda mutación se audita en el servidor, pero la cuenta no muestra «quién cambió qué» (sí existe en la ficha del miembro) | `GET /users/:id/audit` solo por usuario |
| B10 | **Mi perfil / Seguridad desconectados de Cuenta**: tres rutas y menús distintos para «mi cuenta» | `settings/` vs `cuenta/` |
| B11 | **Sin preferencias de la cuenta más allá de lo financiero**: formato de fecha, hora laboral, días hábiles, idioma por defecto | `configuration` sin usar |
| B12 | **Sin zona de peligro**: exportar respaldo desde aquí, suspender/cancelar cuenta, transferir propiedad | Respaldo existe en `/exportar`; el resto no |
| B13 | **Fotos: retención solo informada**: el tope «meses de conservación» se muestra pero ningún proceso lo aplica | Doc §4.2 |

---

## 5. Propuestas

Agrupadas por esfuerzo. «API» = cambio de backend/Prisma; «Web» = solo front.

### A. Reorganización (sin cambios de datos) — recomendado como primer PR

| ID | Propuesta | Resuelve | Esfuerzo | Tipo |
|---|---|---|:-:|---|
| A1 | **Navegación interna por pestañas** en `/cuenta`: *General · Plan · Cobranza · Mensajes* (negocio, plan, mora y categorías, plantillas). Cada rol ve solo las pestañas que puede abrir | B7 | S | Web |
| A2 | **Unificar «Mi cuenta»**: `/settings/perfil` y `/settings/security` como pestañas *Mi perfil* y *Seguridad* dentro del mismo hub, manteniendo las rutas antiguas con redirección | B10 | S | Web |
| A3 | **Barra de guardado única** (sticky) con «Descartar / Guardar» y aviso al salir con cambios pendientes | B8 | M | Web |
| A4 | **Plan rediseñado**: tarjetas de resumen (plan, estado, personas), medidores más claros, fecha de fin de prueba y estado «congelado» visibles | B3 (parcial) | S | Web (la fecha puede requerir exponer un campo existente en el ciclo de vida) |

### B. Datos nuevos de la cuenta

| ID | Propuesta | Resuelve | Esfuerzo | Tipo |
|---|---|---|:-:|---|
| B-1 | **Logo del negocio**: campo `logoUrl`, subida reutilizando el endpoint de upload, mostrado en el encabezado del panel y en recibos | B1 | M | API + Web (+ migración) |
| B-2 | **Contacto del negocio**: dirección, ciudad, teléfono, correo, sitio web. Útil en recibos y plantillas | B2 | M | API + Web (+ migración) |
| B-3 | **Preferencias de la cuenta** en `configuration`: formato de fecha, días y horario laboral (alimenta agenda y recordatorios), idioma por defecto | B11 | M | API + Web |
| B-4 | **Variables de negocio en plantillas** de WhatsApp (`{negocio}`, `{telefono_negocio}`) usando B-2 | B2 | S | Web + móvil (contrato `renderTemplate`) |

### C. Configuración que hoy solo está por API

| ID | Propuesta | Resuelve | Esfuerzo | Tipo |
|---|---|---|:-:|---|
| C1 | **Editor de catálogos**: motivos de no pago, rubros, medios de pago, bancos, tipos de crédito (alta, edición, activar/desactivar, orden). Los endpoints `GET/POST/PATCH /catalogs/:catalog` ya existen | B5 | M | Web |
| C2 | **Agencias / sucursales**: CRUD y asignación de miembros. Conecta con el filtro «su agencia» de supervisores | B6 | L | API + Web |

### D. Plan, facturación y control

| ID | Propuesta | Resuelve | Esfuerzo | Tipo |
|---|---|---|:-:|---|
| D1 | **Solicitar cambio de plan** desde la pantalla: crea un aviso interno (ya hay aviso de ventas al 100 %) en vez de depender de la CLI | B3 | M | API + Web |
| D2 | **Datos de facturación** (razón social, NIT, correo de facturas) y listado de facturas, bajo `/cuenta/facturacion` | B4 | L | API + Web (decisión de producto: sin pasarela) |
| D3 | **Historial de cambios de la cuenta**: pestaña «Actividad» con el audit log filtrado por la cuenta (reutiliza el patrón de la ficha del miembro) | B9 | M | API + Web |
| D4 | **Zona de peligro**: descargar respaldo completo, solicitar suspensión/baja, transferir propiedad a otro administrador (con MFA reciente) | B12 | L | API + Web |
| D5 | **Aplicar la retención de fotos** del plan (proceso programado que archive/borre lo vencido) | B13 | L | API (decisión de producto y legal previa) |

---

## 6. Orden sugerido

1. **PR 1 — Estructura (A1 + A2 + A4):** solo front, riesgo bajo, cambia cómo se percibe la sección.
2. **PR 2 — Barra de guardado y C1 (editor de catálogos):** usa endpoints que ya existen.
3. **PR 3 — Identidad y contacto (B-1 + B-2 + B-4):** primera migración de `Account`.
4. **PR 4 — Actividad (D3) y preferencias (B-3).**
5. **Después, con decisión de producto:** C2 (agencias), D1/D2 (plan y facturación), D4, D5.

## 7. Reglas del repo que aplican a cualquier cambio

- Toda mutación nueva audita quién/cuándo/qué/ip.
- Respuestas de la API siempre `{ data, meta, error }`; DTOs con `forbidNonWhitelisted`.
- Campos sensibles de la cuenta (`planCode`, `limitsOverride`, `status`, `accountType`) **no** pasan por `PATCH /accounts/me`.
- Los textos van en i18n (es/en) en `apps/web/src/messages`.
- Multi-tenant: cualquier tabla nueva lleva `account_id` y RLS.

## 8. Decisiones (resueltas 2026-10-21)

1. **Alcance:** reorganizar **y** datos nuevos (secciones A–D).
2. **`/settings/*`:** se mantiene separado (perfil y datos del usuario). **A2 queda descartada.**
3. **Plan:** lo sigue gestionando Kobrax; sin cobro dentro del producto. D1 pasa a «solicitud» y D2 a «datos de facturación + historial».
4. **Agencias (C2):** entran en este refactor.

El plan de ejecución está en [`cuenta-plan-implementacion.md`](./cuenta-plan-implementacion.md).
