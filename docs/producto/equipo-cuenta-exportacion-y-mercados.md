# Equipo, cuenta, exportación, perfil y roles por mercado — Kobrax

> **Fecha:** 2026-10-13 · **Base:** rama `main` en `5e062fa` (más `feat/descarga-offline`, que no toca estas áreas).
> **Cómo se verificó:** lectura de código en `apps/api`, `apps/web`, `apps/mobile` y `packages/shared`, más `roles-permisos-planes.md` (verificado el 2026-10-09). **No se ejecutó cada pantalla.**
> **Convención:** ✅ existe en el código · 🟡 existe con límite · — no existe · «hoja de ruta» = planificado, sin código.
> **Para qué sirve:** insumo del anexo técnico del concurso y de las conversaciones comerciales. Nombra lo que **no** existe para que ningún texto lo prometa.

---

## 1. Resumen en una página

| Pregunta | Respuesta verificada |
|---|---|
| ¿Cómo se arma un equipo? | El administrador **invita** por correo con un código de un solo uso (7 días), por web o móvil. Se comparte también por WhatsApp. |
| ¿Qué roles se pueden asignar? | **Tres:** administrador, supervisor, cobrador. Existen otros cuatro (super administrador, gerente, auditor, consulta) que **ningún flujo del producto asigna**. |
| ¿Hay un límite de personas? | Sí, por plan: 1, 25, 100 o 500. Es el único tope que el servidor **bloquea**. |
| ¿Quién ve qué dentro de la cuenta? | Aplicado por usuario en **mora, agenda, rutas y visitas**. En **cartera y pagos** la lista filtra por cuenta, no por usuario. |
| ¿Se puede exportar? | Sí: cuatro CSV, y un respaldo completo. Todo auditado y solo para roles con permiso de exportar. |
| ¿Sirve igual a un cobrador solo, a una agencia y a un banco? | **A los dos primeros, hoy.** A una entidad regulada le faltan piezas (§7). |

---

## 2. Equipo

### 2.1 Pantallas

| Dónde | Qué hay | Quién lo ve |
|---|---|---|
| Web `/equipo` | Lista de miembros con rol, estado y consumo del plan («16 de 25»), invitar, cambiar rol, desactivar con traspaso, reenviar y cancelar invitación | `user:read` (administrador y gerente); invitar y cambiar, `user:invite` / `user:write` (solo administrador) |
| Móvil «Mi cuenta → Miembros» | Lista, detalle de un miembro, invitar, reenviar | Según permiso |

### 2.2 Invitar a una persona (flujo verificado)

1. El administrador ingresa **correo, nombre, apellido y rol**.
2. El servidor comprueba el **tope de usuarios** dentro de la misma transacción. **Un invitado pendiente ya ocupa un asiento.**
3. Se crea el usuario en estado *pendiente* y un **código de un solo uso** (formato `K7F29-QX3TM`), guardado solo como hash, **vigente 7 días**. No existe una tabla de invitaciones: reutiliza la de restablecimiento de contraseña.
4. El código se envía por correo y **se muestra una sola vez** a quien invita, con botón **«Compartir por WhatsApp»** (el canal real en campo). Si el correo falla, la invitación queda «Pendiente» y se puede **reenviar** (invalida el código anterior).
5. La persona abre `kobrax://invitacion?c=…` o escribe el código, **fija su contraseña** (política de contraseñas validada en servidor) y queda activa. **No inicia sesión sola**: sigue el login normal.

Límite documentado en el código: **no se puede invitar a un correo que ya tiene cuenta** en otro negocio, aunque el modelo soporte varias cuentas por usuario.

### 2.3 Protecciones del equipo

| Regla | Efecto |
|---|---|
| No editarse a uno mismo | Evita quitarse el propio rol |
| Siempre queda un administrador activo | No se puede desactivar ni degradar al último |
| Desactivar a quien tiene trabajo | Exige **traspasar** agenda, créditos y rutas a otra persona; se hace en una sola transacción y queda auditado |
| Reactivar | También pasa por el tope del plan |
| Sesiones de quien se desactiva | **No se revocan al instante**: la persona puede seguir hasta 15 minutos con su sesión vigente; después no puede renovarla |
| Cancelar invitación | Borra al pendiente; a un miembro activo solo se lo desactiva |

### 2.4 Lo que no hay

- **Roles personalizados:** no existe crear ni editar roles (`GET /roles` es solo lectura).
- **Permisos sueltos por usuario:** la tabla de excepciones existe en el modelo, pero **ningún código la usa**. Los permisos de una persona son exactamente los de su rol.
- **Sucursales:** el modelo existe, pero **no hay API para crearlas ni para asignarlas a un miembro**; solo el seed de demostración las crea.
- **Ingreso corporativo (SSO) e invitación masiva:** no se encontró implementación de ninguno.

---

## 3. Roles

Siete roles de sistema, fijos y globales. Los que el producto permite **asignar** son los tres marcados.

| Rol | Etiqueta | ¿Asignable hoy? | Qué puede hacer |
|---|---|:-:|---|
| `ACCOUNT_ADMIN` | Administrador | ✅ | Dueño de la cuenta: negocio, equipo, plan, importación (incluye reemplazo), pagos, rutas, mora y **también operación de campo**. Es el rol del registro público. |
| `SUPERVISOR` | Supervisor | ✅ | Planifica rutas, asigna agenda y cartera, importa y reparte. Ve su agencia más lo suyo. No aprueba pagos ni edita clientes. |
| `COLLECTOR` | Cobrador | ✅ | Su agenda, su cartera asignada, sus rutas; registra pagos y gestiones; da de alta clientes y créditos; importa. |
| `MANAGER` | Gerente | — (solo seed) | Ve toda la empresa, aprueba pagos, planifica y asigna, importa, exporta. No administra equipo ni cuenta. |
| `AUDITOR` | Auditor | — (solo seed) | Solo lectura con datos personales visibles, reportes y exportación. |
| `VIEWER` | Consulta | — (solo seed) | Lectura gerencial de mora, pagos, rutas y clientes. No escribe. |
| `SUPER_ADMIN` | Super administrador | — | Del lado de Kobrax. Sin uso verificado. |

> **Consecuencia para los textos:** «roles de administrador, gerente, supervisor y cobrador» es correcto como lista de roles **existentes**, pero **gerente no se puede asignar** desde el producto. Para invitar, las opciones son tres.

### 3.1 Qué cambia entre ellos en la práctica

| Capacidad | Administrador | Supervisor | Cobrador |
|---|:-:|:-:|:-:|
| Invitar y administrar equipo | ✅ | — | — |
| Datos del negocio, categorías de mora, plantillas | ✅ | — | — |
| Ver toda la cartera de mora | ✅ | su agencia + lo suyo | solo lo asignado |
| Repartir cartera y asignar agenda | ✅ | ✅ | — |
| Planificar rutas de otros | ✅ | ✅ | — |
| Ejecutar visitas propias | ✅ | — | ✅ |
| Registrar pagos y gestiones | ✅ | ✅ | ✅ |
| Aprobar solicitudes de pago | ✅ | — | — |
| Editar clientes y créditos | ✅ | — | ✅ |
| Importar cartera | ✅ | ✅ | ✅ |
| Exportar cartera completa y respaldo | ✅ | — | — |
| Exportar mora (CSV/PDF) | ✅ | ✅ | ✅ (su alcance) |

---

## 4. Cuenta y configuraciones

### 4.1 Qué se configura (web `/cuenta`, móvil «Mi cuenta → Datos de la cuenta»)

| Configuración | Dónde | Permiso | Estado |
|---|---|---|:-:|
| Razón social, documento fiscal (NIT) | Web y móvil | `account:write` | ✅ |
| País y moneda (BOB, etc.) y decimales | Web y móvil | `account:write` | ✅ |
| Zona horaria (IANA validada) | Web y móvil | `account:write` | ✅ |
| **Cómo se cuenta la mora** por defecto (desde la cuota impaga más antigua / desde el primer atraso, criterio bancario) | Web | `account:write` | ✅ |
| **Categorías de mora** (A, B, C con sus rangos) | Web | `account:write` | ✅ |
| **Plantillas de WhatsApp** | Web | `catalog:write` | ✅ |
| **Catálogos** (motivos de no pago, rubros, medios de pago, bancos…) | API (sin editor completo en pantalla) | `catalog:write` | 🟡 |
| Plan y consumo (miembros, créditos, clientes, fotos, gestiones) | Web y móvil, solo lectura | `account:read` | ✅ |

### 4.2 Plan y topes

| Plan | Personas | Créditos | Clientes | Fotos/mes | Conservación fotos | Gestiones/mes | Precio (USD/mes) |
|---|--:|--:|--:|--:|--:|--:|---|
| Free | 1 | 20 | 20 | 100 | 6 meses | 100 | 0 |
| Professional | 25 | 1.000 | 1.000 | 5.000 | 24 meses | 2.500 | 12 por persona |
| Business | 100 | 5.000 | 5.000 | 25.000 | 60 meses | 12.500 | 99 + 10 por persona |
| Enterprise | 500 (piso) | 50.000 | 50.000 | 250.000 | 120 meses | 125.000 | 800 + 8 por persona |

**Qué se hace cumplir de verdad** (verificado):

| Tope | Comportamiento |
|---|---|
| Personas | **Bloquea** invitar y reactivar (error de tope alcanzado) |
| Créditos y clientes | **Bloquea** crear uno más y también importar más de los que caben. Una acción que ya ocurrió en campo sin señal y llega después se acepta (no se pierde trabajo) |
| Fotos y gestiones por mes | **Solo avisa**: notificación al administrador al 80 %, aviso interno de ventas al 100 %. Nunca bloquea (la gestión llega de campo, ya ocurrida) |
| Conservación de fotos | **Solo se muestra**; no hay proceso que la aplique |

**Cómo cambia el plan:** no hay pantalla ni pasarela de pago. Lo hace el equipo de Kobrax por línea de comandos, con auditoría. **No existe cobro automático.**

**Ciclo de vida:** el alta con plan pago empieza en **prueba de 30 días**; al vencer pasa sola a Free sin borrar nada (lo que exceda queda *congelado*: se puede seguir cobrando, no sumar).

---

## 5. Exportar

| Salida | Contenido | Permiso | Auditado |
|---|---|---|:-:|
| **CSV de clientes** | Nombre, tipo, documento, contacto principal, estado, segmento | `report:export` | ✅ |
| **CSV de ubicaciones** | Direcciones y puntos de los clientes | `report:export` | ✅ |
| **CSV de mora** | Créditos en mora (hasta 1.000 filas), con prioridad y última gestión | `report:export` | ✅ |
| **CSV de agenda** | Gestiones de la agenda | `report:export` | ✅ |
| **Respaldo completo** (`.json.gz`) | Clientes con contactos, ubicaciones, relaciones, garantías y adjuntos; créditos; gestiones; episodios de mora; pagos; agenda | `report:export` | ✅ |
| **Mora en CSV o PDF desde la pantalla de Mora** | Lo que el usuario ve según su alcance | `collection:read` + `collection:export` | — |

**Puntos a decir con precisión:**

- Los datos personales **salen en claro** en los CSV y el respaldo (están descifrados): es un export, no una pantalla. Por eso cada descarga queda registrada.
- **No incluye** rutas, catálogos ni tableros.
- Quien tiene `report:export`: administrador, gerente y auditor. **Supervisor y cobrador no pueden** exportar la cartera completa ni el respaldo.
- No hay exportación programada ni envío automático.

---

## 6. Perfil y seguridad personal

### 6.1 Mi perfil (web `/settings/perfil`, móvil «Mi perfil»)

| Dato | Editable | Nota |
|---|:-:|---|
| Nombre y apellido | ✅ | |
| Teléfono | ✅ | Validación de largo |
| Foto | ✅ | |
| **QR de cobro** (de la cuenta bancaria del cobrador) | ✅ | Se muestra en grande al deudor; el cobro se registra a mano. **No hay pasarela de pago.** |
| Correo | — | Es la identidad de ingreso; no se cambia desde el perfil |
| Idioma (español / inglés) | ✅ | Solo en la web |

### 6.2 Seguridad

| Capacidad | Estado | Nota |
|---|:-:|---|
| Contraseña con política validada | ✅ | Largo mínimo y complejidad, en servidor y en pantalla |
| Cambiar contraseña | ✅ | Cierra las demás sesiones |
| Recuperar contraseña por correo | ✅ | Responde igual exista o no el correo; token de 30 minutos |
| Segundo factor (app autenticadora, QR, 8 códigos de respaldo) | ✅ | Voluntario; **obligatorio para roles críticos** (decisión D2 del 10 de octubre) con una gracia configurable |
| Sesiones activas y «cerrar las demás» | ✅ | |
| Bloqueo por intentos fallidos | ✅ | Límites por correo, IP y endpoint |
| Huella o rostro para desbloquear | 🟡 | Solo móvil; se ofrece **una vez** tras ingresar; **solo desbloquea** la sesión guardada, no hace login |
| Sesión inactiva | ✅ | Ventana de 8 horas |
| Registro de auditoría | 🟡 | Se escribe; **no hay API de lectura ni pantalla** (el permiso de auditoría no está conectado) |

---

## 7. Roles y mercados objetivo

### 7.1 Una advertencia de partida

El modelo prevé cuatro tipos de cuenta, pero **hoy solo uno se usa**:

| Tipo de cuenta | ¿Lo asigna algún flujo? | ¿Cambia algo en el producto? |
|---|:-:|:-:|
| `INDEPENDENT` | ✅ (el registro público) | No |
| `COLLECTION_AGENCY` | — | No |
| `RETAIL_CREDIT` | — | No |
| `FINANCIAL_INSTITUTION` | — | No |

**El tipo de cuenta no cambia la experiencia.** Lo que sí cambia lo que cada cliente ve es **el rol de cada persona** y **el plan**. Por eso la tabla de abajo describe cómo se **configura** el mismo producto para cada mercado, no funciones distintas por mercado.

### 7.2 Encaje por mercado

| | **Cobrador independiente** | **Empresa o agencia de cobranza** | **Banca / entidad financiera** |
|---|---|---|---|
| **Quién es** | Una persona que cobra carteras propias o de pocos clientes | Un negocio con crédito propio (comercio, cooperativa pequeña) o una agencia con varios cobradores | Un banco, una IFD o cooperativa con sucursales, área de riesgo y auditoría |
| **Plan natural** | Free o Professional | Professional o Business | Enterprise, a medida |
| **Personas** | 1 | 5–100 | 100–500+ |
| **Roles que usa** | **Administrador** (opera él mismo; tiene permisos de campo) | Administrador + **supervisores** + **cobradores** | Todos los de abajo, más gerencia, auditoría y consulta |
| **Cómo entra la cartera** | A mano o por archivo | Por archivo, con reparto a cobradores al importar | Por archivo del sistema central; **API: hoja de ruta** |
| **Cómo se reparte** | No aplica | Responsable por crédito, asignación temporal y apoyo | Lo mismo, pero **sin agencias asignables** |
| **Qué le sirve más** | Agenda, ruta, evidencia con huella, QR de cobro, sin conexión | Reparto, planificación de rutas, supervisión, historial por corrida | Trazabilidad, exportación, importación con historial |
| **Estado** | ✅ **Listo hoy** | ✅ **Listo hoy** (equipos pequeños y medianos) | 🟡 **Parcial: ver §7.3** |

### 7.3 Qué le falta a una entidad regulada

Se dice sin adornos, porque un evaluador técnico lo verá:

| Necesidad típica de un banco | Estado hoy |
|---|---|
| Asignar **gerente, auditor o consulta** a personas reales | — Existen, pero ningún flujo del producto los asigna (solo seed) |
| **Sucursales** con supervisores por agencia | 🟡 Modelo sí; **sin API para crearlas ni asignarlas**. Un supervisor sin agencia ve solo lo suyo |
| **Alcance por usuario en cartera y pagos** | — Las listas de clientes, créditos y pagos filtran por cuenta, no por usuario |
| **Alcance por fila en la base de datos (RLS por usuario)** | — Solo hay aislamiento entre cuentas; las políticas por alcance están definidas pero no activas |
| **Consulta del registro de auditoría** | — Se escribe, no se puede leer desde el producto |
| **Roles a medida y permisos por excepción** | — Modelo sin función |
| **Ingreso corporativo (SSO)** | — No existe |
| **Recepción de cartera por API** | — Hoja de ruta; la arquitectura de importación ya está separada del archivo |
| **Cobro integrado y facturación** | — No existe pasarela; el plan se cambia a mano |
| **Retención de evidencia por norma** | 🟡 El plan declara los meses, pero **no se aplica**; el número real depende de lo que exija el regulador |

**Lectura honesta:** la base multiempresa, el aislamiento entre cuentas, la evidencia inmutable y la trazabilidad **ya sirven a una entidad**. Lo que falta es la **capa de gobierno** (quién ve qué dentro de la entidad, y poder auditarlo), que es justo lo que ese mercado exige primero.

### 7.4 Orden sugerido para cerrar la brecha de banca

| # | Pieza | Por qué primero |
|---|---|---|
| 1 | Asignar gerente, auditor y consulta desde el producto | Es lo más barato y desbloquea las demás |
| 2 | Crear y asignar sucursales | Sin esto el supervisor no tiene agencia que ver |
| 3 | Alcance por usuario en cartera y pagos | Cierra la diferencia entre lo que se promete y lo que se aplica |
| 4 | Pantalla de auditoría | Es lo que la entidad pide en cualquier revisión |
| 5 | Alcance en base de datos (RLS por usuario) | Defensa en profundidad |
| 6 | Recepción por API | Quita la dependencia del archivo manual |

---

## 8. Cómo contarlo sin sobreprometer

| Decir | No decir |
|---|---|
| «Un administrador invita a su equipo con un código de un solo uso, por correo o WhatsApp» | «Gestión de usuarios empresarial» |
| «El aislamiento entre empresas es total» | «Cada persona ve solo lo que su rol permite» (solo es cierto en mora, agenda y rutas) |
| «Hay roles de supervisor y cobrador con alcance sobre mora, agenda y rutas» | «Control de acceso por sucursal» |
| «Todo export queda auditado» | «Auditoría consultable» |
| «Hoy sirve al cobrador independiente y a agencias; la capa de gobierno para banca está en la hoja de ruta» | «Listo para banca» |

---

## 9. Por verificar antes de citar

1. Que el **alcance en cartera y pagos** siga sin aplicarse (verificado el 2026-10-09 y sin cambios detectados en los commits posteriores de esos archivos).
2. Que **gerente** siga fuera de los roles invitables.
3. Que el aviso de **fotos y gestiones** siga siendo solo informativo (no bloquea).
4. Con una **cuenta independiente real**, que el administrador vea y opere toda su cartera en la web (se infiere del permiso, no se vio en pantalla).
5. Qué exige **ASFI** de retención de evidencia: el número de 120 meses es simetría con la escalera de planes, no norma.
