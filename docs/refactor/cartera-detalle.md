# KOBRAX — Refactor de la ficha del cliente (perfil operativo)

> Plan de ejecución. Objetivo visual: `docs/refactor/Perfil Operativo del Cliente - Optimizado.png`.
> Estado de partida: `docs/refactor/detalle.JPG` (lo que hay hoy en `/cartera/[id]`).

---

## Qué cambia, en una línea

La ficha pasa de ser **una columna de cajas planas** —Datos, Créditos, Teléfonos, Direcciones,
Garantes, Garantías, Adjuntos, todas del mismo peso— a un **perfil operativo de dos columnas**: a la
izquierda lo que se trabaja (créditos, contacto, direcciones, adjuntos), a la derecha lo que se
consulta (resumen de cuenta, bitácora, garantes, garantías).

La pregunta que la pantalla tiene que contestar en dos segundos cambia de «¿qué datos tiene esta
persona?» a **«¿cuánto debe, qué se hizo con ella y a quién puedo ir a buscar?»**.

---

## FASE 0 — Auditoría (hecha)

### Lo que YA existe y se reusa tal cual

| Necesidad del mockup | Con qué se resuelve hoy |
|---|---|
| Créditos del cliente | `GET /credits?clientId=` — trae `code`, `principalAmount`, `outstandingBalance`, `currency`, `status`, `daysPastDue` y `metadata` (cuota congelada, próximo vencimiento, frecuencia, origen) |
| Click en un crédito → su detalle | La ruta ya existe: `/cartera/[id]/credito/[cid]` |
| Balance total · créditos totales | **Sale gratis**: son las columnas denormalizadas `total_debt` / `credit_count` que ya mantiene el trigger |
| Teléfonos, direcciones, garantes, garantías, adjuntos | `GET /clients/:id` los devuelve todos, enmascarados |
| «+ Agregar» por sección | Los sub-endpoints ya están: `POST /clients/:id/contacts · locations · relations · collaterals · attachments` |
| Sección de Casos | `GET /cases?clientId=` ya filtra por cliente |
| Ver la PII en claro | `GET /clients/:id?reveal=true`, y **queda auditado** (`PII_REVEAL`) |

### Lo que NO existe y hay que construir

1. 🔴 **Los pagos no se pueden pedir por cliente.** `GET /payments` filtra por `creditId`, `caseId` y
   fechas — no por `clientId`. Sin eso no hay «últimas cobranzas» sin hacer una llamada por crédito.
   → un campo en el DTO y una condición en el `where`. Cambio chico y compatible hacia atrás.
2. 🔴 **No hay línea de tiempo por cliente.** Lo que el mockup llama «bitácora» vive en **tres
   tablas**: `agenda_items` (promesa, llamada, visita), `case_activities` (gestiones del caso) y
   `payments` (cobranzas). Ninguna se puede pedir por cliente y ordenada junta. Ver §Decisión 1.
3. **El «tipo» de crédito no existe en el modelo.** El mockup dice «Crédito de consumo» y «Préstamo
   personal»; en la base sólo hay `origin` (manual/import) y `frequency`. Ver §Decisión 3.
4. **«Vencidos» del resumen** no es una columna: hoy se cuenta mirando `daysPastDue > 0` de los
   créditos que ya se traen. No hace falta nada nuevo, pero **hay que decir qué cuenta como vencido**
   (§Decisión 4).

### Lo que se queda igual (y por qué)

- **El revelado sigue siendo auditado.** Es el único punto de la pantalla donde alguien mira datos
  personales en claro; eso no se toca por estética.
- **La edición completa sigue siendo una pantalla aparte** (`/cartera/[id]/editar`), con su diff y su
  guardado atómico. Ver §Decisión 5.
- **Los adjuntos no se pueden abrir desde el panel.** Se listan por tipo, fecha y huella. Sigue así:
  el mockup dibuja una zona de subida, no un visor.
- **`CreditsSection` y los sub-endpoints**: cambia cómo se ven, no de dónde salen.

---

## La pantalla, sección por sección

### Encabezado (lo que el mockup no dibuja y hay que conservar)

```
Nelson Nina Apaza                    [Activo]  [Nuevo préstamo]  [Editar]  Dar de baja
Persona · BLK11***
```

El mockup empieza directo en CRÉDITOS. Se conserva el encabezado actual entero: estado, **Nuevo
préstamo**, **Editar** y **Dar de baja** (que sigue escondiéndose cuando hay créditos activos, y
rebotando en la API aunque alguien fuerce la URL).

### Columna izquierda

**1 · CRÉDITOS** — acordeón, uno por crédito.

- Cerrado: código · tipo · MONTO TOTAL · badge de estado · «Hace N días» si está pagado.
- Abierto: Monto total · Cuota mensual · Saldo pendiente, y la **barra de progreso de pago**.
- 🔴 **La tarjeta entera es un link a `/cartera/[id]/credito/[cid]`**, salvo el chevron que abre el
  acordeón. Abrir y navegar son dos intenciones distintas y no pueden compartir el mismo clic.
- «Ver historial» filtra a los pagados/cancelados; por defecto se ven los vivos.

**2 · CONTACTO** y **DIRECCIONES**, lado a lado, cada uno con su `+ Agregar`.

- Cada fila: ícono, valor enmascarado, subtítulo (tipo · etiqueta) y botón **Mostrar**.
- El teléfono principal lleva su badge `PRINCIPAL`.
- Direcciones: `Ver en mapa` por fila.

**3 · ADJUNTOS Y DOCUMENTOS** — zona de subida con borde punteado y vacío explicado («Subí copias de
CI, certificados de trabajo o facturas de servicios»). El texto del vacío **enseña qué subir**: es la
diferencia entre un legajo completo y uno vacío.

**4 · CASOS** (al final, no está en el mockup) — la lista de casos de cobranza del cliente, con
estado, prioridad y cobrador asignado; cada uno linkea a `/casos/[id]`.

### Columna derecha

**1 · RESUMEN DE CUENTA** — tarjeta oscura: balance total adeudado en grande, y debajo créditos
totales / vencidos.

**2 · BITÁCORA DE ACTIVIDAD** + «Ver todo» — línea de tiempo con punto de color por tipo: título,
detalle y cuándo. Incluye **las últimas cobranzas**.

**3 · GARANTES** y **4 · GARANTÍAS REALES** — con vacío ilustrado y su botón de agregar.

---

## Decisiones que hay que cerrar antes de construir

### 1. ¿De dónde sale la bitácora?

- **A · Componer en el panel.** El server component pide agenda + actividades + pagos y los mezcla.
  Barato, sin backend nuevo. Contra: «Ver todo» no puede paginar de verdad (tres fuentes con tres
  paginaciones), y la regla de qué entra en la bitácora queda escrita en la vista.
- **B · `GET /clients/:id/timeline`** — un endpoint que une las tres tablas, ordena por fecha y
  pagina. Contra: es un endpoint nuevo. A favor: la bitácora es una **pregunta del dominio**, no un
  arreglo de pantalla, y el móvil va a querer la misma.

**Recomendación: B**, con A como atajo aceptable si se quiere ver algo esta semana.

### 2. ¿«Mostrar» revela por fila o sigue revelando toda la ficha?

Hoy: un botón revela todo y deja **una** entrada de auditoría.

- **A · Se pide la ficha con `reveal=true` al tocar el primer «Mostrar»**, y de ahí en más cada
  botón sólo destapa lo suyo en pantalla. Una entrada de auditoría, como hoy. Simple y honesto: lo
  que se auditó es «esta persona pidió ver los datos de este cliente», que es la verdad.
- **B · Un endpoint por campo**, con una entrada por dato revelado. Auditoría más fina, tres veces
  más superficie.

**Recomendación: A.**

### 3. ¿Qué dice el subtítulo del crédito?

No hay «tipo de crédito» en el modelo.

- **A · Catálogo `CREDIT_TYPE` por empresa** (igual que `COLLATERAL_TYPE`): cada una arma su lista.
- **B · Mostrar lo que ya existe**: frecuencia + origen («Mensual · importado»).
- **C · Sin subtítulo.**

**Recomendación: A** si el dato importa para cobrar; **B** si es sólo decoración.

### 4. ¿Qué cuenta como «vencido» en el resumen?

`daysPastDue > 0` sobre créditos activos es lo más directo y coincide con la columna Mora de la
cartera. Confirmar que es eso y no «con cuota vencida en el cronograma», que es otro número.

### 5. ¿La edición inline reemplaza la pantalla de edición?

**Recomendación: no.** Los `+ Agregar` de la ficha usan los sub-endpoints —agregar un teléfono es
una llamada, no un guardado del formulario entero— y el botón **Editar** sigue llevando a la
pantalla completa para lo demás (nombre, documento, estado, y editar o borrar lo que ya está).
Mantener dos formas de editar lo mismo es lo que ya se pagó una vez en el móvil.

### 6. ¿«Ver en mapa» abre un mapa?

`maplibre` son 250 kB y hoy sólo se cargan en `/rutas/[id]`. Si el link abre un mapa embebido, la
ficha entera paga ese peso. **Recomendación:** cargarlo por `import()` dinámico sólo al tocar el
link, en un modal. La dirección sin punto marcado no muestra el link.

---

## Orden de implementación

```
FASE 1  Backend        → `clientId` en GET /payments · (Decisión 1) timeline · (Decisión 3) catálogo
FASE 2  Layout         → dos columnas + encabezado conservado; secciones vacías en su lugar
FASE 3  Créditos       → acordeón, progreso de pago, link al detalle, «Ver historial»
FASE 4  Contacto y direcciones → dos columnas, «Mostrar» por fila, «+ Agregar» por sub-endpoint
FASE 5  Columna derecha → resumen de cuenta, bitácora, garantes, garantías
FASE 6  Casos y adjuntos → sección de casos al final; zona de subida con vacío que enseña
FASE 7  Tests + revisión → lógica pura con test; la pantalla, a ojo
```

## Qué NO hacer

❌ Rehacer el formulario de edición: la ficha agrega, la pantalla de edición corrige.
❌ Traer los pagos con una llamada por crédito.
❌ Cargar `maplibre` en toda ficha por un link que casi nadie toca.
❌ Un tercer lugar donde se calcule la deuda: el balance sale de las columnas denormalizadas, las
mismas que ordena la cartera.
❌ Estados por color solamente: cada badge lleva su texto.
