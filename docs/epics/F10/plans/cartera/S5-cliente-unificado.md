> **ESTADO: EN BORRADOR — ronda 1 (2026-07-28). NO construir hasta PASS de `/f10-validar-plan`.**

# F10 · Cartera · S5 — Un solo formulario de cliente (alta y edición)

## 1. Objetivo
Que crear y editar un cliente sean **la misma pantalla**. Hoy son dos: el alta tiene teléfonos,
ubicaciones y garantes; la edición sólo tiene los datos base del cliente —y encima el financiero del
crédito—, así que **una dirección cargada mal no se puede corregir desde el móvil**. De paso, el botón
"Navegar" deja de mandar al cobrador fuera de la app.

## 2. Rama
`f10/cartera-s5-cliente-unificado` (sale de `main` con Rutas S2 ya mergeado: S2 tocó `cliente/nuevo`).

## 3. Build
🔵 dev build (el formulario incluye `MapPicker`). Sin cambios nativos: no hace falta rebuild.

## 4. Pantallas Figma
No hay pantalla nueva: es **la del alta** (`cliente/nuevo`, cartera S2) sirviendo a los dos caminos.
El punto de entrada de edición ya existe (el lápiz de la ficha, `cliente/[id]`).

## 5. Contrato (verificado contra el código, 2026-07-28)

| Uso | Endpoint | Estado |
|---|---|---|
| Datos base del cliente | `PATCH /api/clients/:id` | Existe (`UpdateClientPatch`) |
| Teléfonos | `POST` · `PATCH` · `DELETE /api/clients/:id/contacts[/:cid]` | Existen los tres |
| Ubicaciones | `POST` · `DELETE /api/clients/:id/locations[/:lid]` | ⚠ **falta `PATCH`** → §5.1 |
| Garantes | `POST` · `DELETE /api/clients/:id/relations[/:rid]` | Existen (sin PATCH: se borra y se crea) |
| Hidratar el formulario con PII en claro | `GET /api/agenda/clients/:id/context` | Existe y **revela con auditoría**, pero sólo si el cliente tiene un caso del cobrador → §5.2 |

Tablas: `clients`, `client_contacts`, `client_locations`, `client_relations`.

### 5.1 Delta: `PATCH /clients/:id/locations/:lid`
Sin él, corregir "Calle Junín 10" o mover el punto obliga a borrar la ubicación y crear otra: cambia
el id y se pierden sus fotos y notas de referencia. El PATCH acepta los mismos campos que el POST
(`address`, `zone`, `latitude`, `longitude`, `locationType`, `referenceNotes`), todos opcionales.

### 5.2 Delta: revelar para editar (D-S5-PII)
`clients.findOne(id, reveal)` hoy sólo revela con `CLIENT_PII_READ`, que el cobrador **no tiene**. El
único camino que revela para él es el de agenda, y exige que el cliente tenga un caso suyo — un cliente
sin préstamo se editaría contra datos enmascarados y **se guardaría la máscara encima del dato real**.

Decisión de la usuaria: **si lo podés ver, lo podés editar.** La regla pasa a ser: con `CLIENT_READ`
se revela para edición, **auditando** el revelado (`client/PII_REVEAL`, igual que hoy). Los permisos
finos son F3/P10 — la regla del proyecto es construir con la capacidad encendida y cablear el guard al
final, no ramificar por rol ahora.

> Consecuencia a dejar por escrito: con esto, cualquier usuario con `CLIENT_READ` ve teléfonos y
> direcciones en claro. Es un ensanchamiento real de superficie, aceptado a conciencia y auditado.

### 5.3 Delta: "Navegar" se queda en la app (D-S5-MAPA)
Hoy `actionLinks()` arma `geo:`/`maps:` y `Linking.openURL` abre Google Maps. Pasa a abrir una vista
propia con `MapCanvas`: el cliente marcado y la ubicación del cobrador. Sin motor de ruteo —eso es la
decisión abierta de Rutas S3—, pero sin salir de Kobrax y funcionando con los packs offline.

## 6. Auditoría de reuso

| Capacidad | Decisión | Dónde |
|---|---|---|
| Formulario completo (datos, teléfonos, ubicaciones, garantes) | **EXTENDER → MOVER** | Hoy vive dentro de `app/cliente/nuevo.tsx` (324 líneas). Se saca a `src/cliente-form-view.tsx` para que lo usen alta y edición. **Es el corazón del slice: no se copia.** |
| Estado y validación del formulario | **REUSAR** | `src/cliente-form.ts` (`ClienteForm`, `initialCliente`, `clienteEnPunto`, `buildClientePayload`, `canSubmitCliente`) |
| Elegir punto en el mapa | **REUSAR** | `src/maps/MapPicker.tsx` |
| Mapa para "Navegar" | **REUSAR** | `src/maps/MapCanvas.tsx` (ya tiene marcadores y controles) |
| Ubicación del dispositivo | **REUSAR** | `expo-location` (ya se usa en el alta) |
| Traer el cliente con PII en claro | **REUSAR** | `clientContext` de `agenda.service` — o `getClient` si §5.2 lo habilita para todos |
| Escribir cliente / teléfonos / garantes | **REUSAR** | `src/clients.service.ts` (`updateClient` + sub-recursos) |
| Guardar ubicaciones editadas | **EXTENDER** | `src/clients.service.ts` › `updateLocation()` (§5.1) |
| Diferencia entre lo que hay y lo que quedó | **NUEVO** | `src/cliente-diff.ts` — qué agregar, editar y borrar de cada sub-recurso. Puro y testeable, mismo patrón que `route-draft.diffStops` |
| Vista de "Navegar" | **NUEVO** | `app/cliente/mapa.tsx` — de un solo uso |

**Cero componentes nuevos en `ui.tsx`.** El trabajo es mover lo que ya existe, no escribir de nuevo.

## 7. Artefactos nuevos
1. `src/cliente-form-view.tsx` — el formulario, sin saber si crea o edita. Recibe estado + callbacks.
2. `src/cliente-diff.ts` (+ test) — comparar el formulario contra lo que hay en el server y devolver
   las llamadas a hacer. Sin esto, editar sería borrar todo y volver a crear.
3. `app/cliente/mapa.tsx` — el punto del cliente en el mapa de Kobrax (§5.3).
4. API: `PATCH /clients/:id/locations/:lid` (§5.1).

## 8. Tareas
1. Backend §5.1: `PATCH` de ubicación + test.
2. Backend §5.2: revelar con `CLIENT_READ` + auditoría + test (que se audite, y que sin permiso no).
3. Mover el formulario a `src/cliente-form-view.tsx`; `cliente/nuevo` pasa a ser su cáscara. **Sin
   cambios de comportamiento**: el alta tiene que seguir haciendo exactamente lo mismo.
4. `src/cliente-diff.ts` + test (agregar, editar, borrar, sin cambios = cero llamadas).
5. `cliente/editar` pasa a usar la misma vista, hidratada. Lo financiero del crédito **se queda donde
   está** (es del préstamo, no del cliente) — se accede desde la ficha como hoy.
6. `app/cliente/mapa.tsx` + cambiar el botón Navegar de la ficha y del detalle de agenda.
7. Verificación: `type-check` + `jest` (API y móvil) + `expo export`.

## 9. Reglas de la fase
- Las tres de §3.3 (sol→contraste, gama baja, animación con propósito).
- **Una entidad, un formulario.** Si aparece un tercer lugar donde se cargan datos de cliente, usa esta
  vista o no se hace.
- El alta no puede cambiar de comportamiento: es código ya validado en campo.
- Nada de ramificar por rol; la capacidad se enciende y F3/P10 cablea el guard.

## 10. DoD
- [ ] Crear y editar un cliente usan **la misma pantalla**, con teléfonos, ubicaciones y garantes.
- [ ] Se puede corregir una dirección: el texto ("Calle Junín 10") **y** el punto (manual, GPS o mapa).
- [ ] Editar una ubicación conserva su id (no se borra y se crea).
- [ ] Un cliente sin préstamos también se edita, y el revelado queda auditado.
- [ ] Guardar sin tocar nada no dispara ninguna llamada de escritura.
- [ ] "Navegar" abre el mapa de Kobrax, no Google Maps.
- [ ] Un cliente cargado desde el mapa de Rutas aparece pintado tras cargarle la ubicación (cierra el
      DoD de Rutas S2 que hoy no se puede cumplir).
- [ ] `type-check` + `jest` verdes en API y móvil + `expo export`.
- [ ] `/code-review` + `/ponytail-review` y validación visual por la usuaria.

## 11. Decisiones cerradas (con la usuaria, 2026-07-28)
- **D-S5-UNICO — un solo formulario para alta y edición**, en toda la app.
- **D-S5-PII — si lo podés ver, lo podés editar.** Se revela con `CLIENT_READ`, auditado; los permisos
  finos quedan para F3/P10.
- **D-S5-MAPA — "Navegar" muestra el punto en el mapa de Kobrax**, sin motor de ruteo (eso es S3).
- **D-S5-CREDITO — el financiero del préstamo NO entra al formulario de cliente** (decisión del
  arquitecto, sin objeción de la usuaria): son dos entidades, y mezclarlas es lo que hace confusa la
  pantalla de hoy.

## 11.1 Requisito agregado por la usuaria (2026-07-28, con captura del alta)
**La vista del alta ES el estándar**: datos + teléfonos (tipo, número, WhatsApp, principal) +
ubicaciones + **garantes, cada uno con sus propios teléfonos y ubicaciones**. Mismos campos y misma
forma en todos lados; ninguna pantalla define los suyos.

**Consecuencia para el mapa (Rutas):** un cliente no tiene "una" ubicación — tiene la casa, el
negocio, la del garante, la de la familia. El mapa tiene que poder mostrarlas y cargarlas **todas**,
así que pasa a pintar **un pin por ubicación**, no uno por cliente. Hoy `portfolioExtra` (Rutas S2)
devuelve un solo punto: la ubicación primaria. Queda anotado como el delta que abre ese cambio —
`GET /cases?view=portfolio` tendría que devolver la lista de ubicaciones del cliente, y la parada
seguiría eligiendo una. **No entra en este slice**: se decide al construirlo, para no ensanchar S5
mientras arregla lo que hoy está roto.

## 12. Riesgos
- **Mover el formulario es un refactor sobre código ya validado en campo** (cartera S2). El riesgo no
  es escribirlo, es cambiarlo sin querer: el alta se prueba igual que la edición antes de mergear.
- **§5.2 ensancha quién ve PII.** Aceptado y auditado, pero es la clase de decisión que conviene
  revisar cuando F3 traiga roles de verdad.

## ⏸️ Pendiente de confirmar
- (nada) — las cuatro decisiones quedaron cerradas.
