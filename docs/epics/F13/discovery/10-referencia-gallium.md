# Discovery · 10 · Referencia Gallium (sección de Oficinas)

> **Estado: COMPLETO 2026-11-02.** Método: `../../_framework/README.md` §2 · hallazgos en plantilla T1 · lectura **solo lectura** de `C:\Tutator\gallium-10` (otro proyecto, no se modificó). Commit leído: `7582a6f73` (2026-11-02).
> Origen del requisito: **R2/R7** de `../decisions/DECISIONS.md` (la vista de oficinas de Kobrax debe ser **igual** que la de Gallium; solo se adapta lo que el modelo de Kobrax exija). Esto es lo observado, no un diseño: no propone cambios.
> Todas las rutas de archivo van relativas a `C:\Tutator\gallium-10\apps\web\src` salvo que se indique otra raíz. `AGENTS.md` del módulo: `app/(dashboard)/admin/offices/AGENTS.md`.

## 1. Stack y ubicación

| Aspecto | Gallium | Fuente |
|---|---|---|
| Framework | Next.js 16 (App Router), React Query 5, **PrimeReact 10** (Dialog, Menu, Dropdown, SelectButton, Tag, Chip), Leaflet para el mapa, next-intl | `apps/web/package.json` (`next ^16.4.2`, `primereact ^10.8.5`, `@tanstack/react-query ^5.100.9`, `leaflet ^1.9.4`) |
| Monorepo | `apps/web`, `apps/worker`, `packages/shared` (sin API separada: los route handlers de Next son el backend) | listado de `C:\Tutator\gallium-10` |
| Datos | Prisma sobre `apps/web/prisma/schema.prisma`; servicios y repositorios en `src/server/**` | `schema.prisma:99-152`; `server/services/office.service.ts` |
| Raíz de la sección | `/admin/offices` (sección admin, menú «admin») | `components/AppShell/nav-config.ts:151` |
| Otro proyecto, otro tenant model | **Gallium no tiene `account_id`**: la tabla `office` no lleva columna de cuenta/tenant | `prisma/schema.prisma:99-136` (ninguna columna de cuenta) |

## 2. Mapa de rutas y archivos

| Ruta | Archivo | Qué es |
|---|---|---|
| `/admin/offices` | `app/(dashboard)/admin/offices/page.tsx:1-34` | Shell servidor: título «Oficinas», acciones «Papelera» y «Añadir oficina», cuerpo `fill` |
| (cliente) | `…/office-page-client.tsx:25-59` | Alterna **Árbol / Mapa** con `SelectButton` (árbol por defecto) |
| (árbol) | `…/office-tree-client.tsx` (587 líneas) | Orquestador del árbol: consulta, estado, mutaciones, drag-and-drop, diálogos |
| (mapa) | `…/office-map-client.tsx` (470 líneas) | Mapa Leaflet con barra lateral de oficinas con GPS; carga diferida `ssr:false` |
| `/admin/offices/new` | `…/new/new-office-client.tsx:15-36` + modal interceptor `app/(dashboard)/@modal/(.)admin/offices/new/page.tsx:13-30` | Crear: modal en navegación suave, página completa como respaldo; acepta `?parentId=` |
| `/admin/offices/[id]` | `…/[id]/office-detail-client.tsx` (450 líneas) | Detalle de solo lectura |
| `/admin/offices/trash` | `…/trash/trash-client.tsx` (175 líneas) | Papelera de oficinas borradas + restaurar |
| (editar) | `components/offices/OfficeEditDialog.tsx` | **No hay ruta de edición**: es un diálogo controlado que se abre desde el árbol o desde el detalle (`AGENTS.md` del módulo, «Structure») |

Componentes del módulo: `components/{TreeSearch,TreeNode,TreeNodeActions,NodePreviewDialog,QuickAddDialog}.tsx`, `hooks/useTreeState.ts`, `offices.css` (785 líneas; los nombres de clase son contrato con e2e, `AGENTS.md` «Conventions»).
Componentes compartidos (`components/offices/`): `badges.tsx`, `HoursDisplay.tsx`, `HoursEditor.tsx`, `IconPicker.tsx`, `SkeletonRows.tsx`, `OfficeStats.tsx`, `OfficeForm.tsx` (683 líneas), `OfficeEditDialog.tsx`, `OfficeRelations.tsx`, `office-types.ts`, `useOfficeTypes.ts`.

## 3. Estructura de la pantalla (lo que ve la persona)

### 3.1 Pantalla principal: árbol

Orden vertical: encabezado con título + `Papelera` + `Añadir oficina` (`page.tsx:15-27`) → fila con el conmutador Árbol/Mapa alineado a la derecha (`office-page-client.tsx:38-55`) → tarjeta del árbol con borde y radio 10 (`office-tree-client.tsx:551-561`) que contiene:

1. **Barra de herramientas** (`TreeSearch.tsx:43-127`): buscador con icono y botón limpiar (Esc limpia); a la derecha contador «N oficinas», separador y **control de nivel** (colapsar todo · −1 · valor actual o «—» · +1 · expandir todo). El control de nivel solo aparece si `maxDepth > 0` (`:75`).
2. **Banner de error** de mover/borrar (`office-tree-client.tsx:415-419`).
3. **Zona «soltar para nivel superior»**, solo mientras se arrastra (`:422-432`, texto «Suelta aquí para mover al nivel superior»).
4. **Cuerpo del árbol** (`:438-493`), también marcado como zona de soltado raíz.
   - Cargando: `SkeletonRows` de 10 filas (`:440`).
   - Banner de filtro «N resultados para «q»» (`:470-475`).
   - Filas recursivas `TreeNode`.

### 3.2 Fila del árbol (`TreeNode.tsx:80-183`)

De izquierda a derecha: chevron expandir/colapsar (oculto si no hay hijos; Alt/Shift+clic expande toda la rama, `:107-112`) · icono emoji o `pi-building` (`:123-129`) · nombre (o código) y, bajo la raíz, ciudad (+ país si no es «United States», `:132-142`, **valor fijo en código**) · metadatos: spinner si se está moviendo, **badge de tipo**, **badge de código**, **punto de estado** activo/inactivo y **contador de hijos directos** con icono de sitemap (`:145-170`) · botón ⋮ de acciones (`:173-182`). El `title` de la fila es dirección → nombre → código (`:98`). Los hijos se renderizan indentados dentro de `.tree-children` (`:186-202`). Click en la fila abre la vista previa; arrastrar > 5 px la mueve (`office-tree-client.tsx:254-312`).

### 3.3 Menú de acciones por nodo (`TreeNodeActions.tsx:71-127`)

`Editar` · `Añadir hija` (navega a `/admin/offices/new?parentId=`) · `Alta rápida` (diálogo corto) · `Ver detalle` · separador · `Eliminar` (confirmación con `useGa10ConfirmAction`, severidad `danger`).

### 3.4 Vista previa al hacer clic (`NodePreviewDialog.tsx:61-221`)

Diálogo de 480 px. Cabecera: icono + nombre + **ruta de ancestros** (`getOfficePath`, separada por « / », `office-types.ts:47-57`). Cuerpo: badges (estado, tipo, código) → rejilla de 2 columnas: «Oficina superior» a ancho completo, luego Ciudad, País, Teléfono, GPS (solo los no vacíos, `:87-92`) → horario si hay → divisor → chips con **conteos** (beneficiarios, documentos) desde `GET …/stats` (`:72-76,209-218`). Pie: `Editar` (primario) · `Detalles completos` · `Cerrar`.

### 3.5 Alta rápida (`QuickAddDialog.tsx:48-160`, 400 px)

Título «Alta rápida bajo {padre}». Campos del esquema `office-quick-add` (`components/forms/schemas/office-quick-add.ts:17-30`): **código** (mono, mayúsculas, regex `^[a-zA-Z0-9_-]+$`), **nombre** (opcional), **tipo** (select desde el catálogo `OFFICE_TYPE`). Valida: vacío → formato → duplicado contra los códigos existentes en el cliente (`:82-97`). Guarda con guarda de descarte si hay cambios (`:72-73`).

### 3.6 Crear / editar (`OfficeForm.tsx`)

Formulario de **3 pestañas** con punto de error por pestaña (`:124,316-337`):
- **Identidad**: código* (único, mayúsculas), nombre, **oficina superior** (dropdown con filtro, opción «Ninguna», excluye a sí misma; `:166-180,399-419`), **tipo** (dropdown del catálogo, `:420-438`), **estado** (Activo/Inactivo; `:205-207,442-476`), icono (selector emoji, `IconPicker`) (`:479-489`).
- **Ubicación**: país, región, ciudad, GPS, dirección y subcampos de dirección estructurada (calle, código postal, ciudad, país) (`:493-565`).
- **Contacto**: teléfono, **horario** (`HoursEditor`, máx. 7 filas `días/apertura/cierre`, `schemas/office.ts:10-16,32`), notas (`:569-604`).
Al editar, si cambió el padre, llama aparte a `moveOffice` (`:280-285`) porque ese endpoint hace el chequeo de ciclo y de existencia del padre.
Crear: modal (`ModalFormShell`, tamaño `lg`) o página (`FormPageShell`); editar: `OfficeEditDialog` (`AppDialog` + guarda de descarte).

### 3.7 Detalle (`[id]/office-detail-client.tsx`)

Migas `Oficinas › {nombre}` (`:185-191`) → **hero** con icono grande, título, badges (estado/tipo/código) y botones `Editar` o, si está en papelera, `Restaurar`; `Volver` (`:194-227`) → enlace «Superior: {nombre}» (`:230-239`) → rejilla 2 columnas: tarjeta **Información general** (código, nombre, tipo, icono, país, región, ciudad, GPS, teléfono; más dirección y notas a ancho completo, `:171-181,243-251`) y columna derecha con **Estadísticas** (`OfficeStats`, `:254-256`) y **Sub-oficinas** (hasta 6 filas + «y N más», `:258-275`) → **Relaciones** (`:281-285`) → **Horario** (`:289-306`) → **Historial de auditoría** con carga bajo demanda (`:309-363`).
`OfficeRelations.tsx`: pestañas Usuarios · Contactos · Documentos · Beneficiarios con contador (`:22,83-113`), tabla paginada por cursor de 10 filas (`:61-67`), «Cargar más» (`:156-165`); estado 403 con candado (`:116-120`); estado vacío con icono (`:125-131`). Las tarjetas de Estadísticas navegan a la pestaña correspondiente (`onSelect`).

### 3.8 Asignación de usuarios a oficinas

**No se hace desde la pantalla de oficinas**: se hace desde el detalle del usuario, pestaña «Roles y permisos» → sección «Oficinas asignadas» (`app/(dashboard)/admin/users/[id]/tabs/RolesPermissionsTab.tsx:148-195`): lista de oficinas del usuario (chip con código + nombre + botón Quitar), y, si `canWrite`, un dropdown filtrable de oficinas no asignadas + botón «Añadir oficina» (`:170-192`). La lista de candidatos sale de `listOffices({limit:200})` (`:71`). Desde la oficina solo se **ve** quién pertenece (pestaña Usuarios de Relaciones, solo lectura).

### 3.9 Papelera (`trash/trash-client.tsx`)

Tabla con columnas Nombre · Código · Tipo · Eliminada · acción `Restaurar` (`:55-70`); estado vacío «La papelera está vacía» con ayuda (`:46`). Restaurar invalida `officeKeys.all` (`:30`).

### 3.10 Mapa (`office-map-client.tsx`)

Leaflet + OSM, barra lateral con buscador y marcadores solo de oficinas con GPS, color por tipo (`typeColor`, hash estable del código del tipo, `office-types.ts:13-31`). Agrupación de marcadores: **no construida** (`AGENTS.md` «Deferred»).

## 4. Modelo de datos

| Tabla | Campos | Fuente |
|---|---|---|
| `office` | `id` (varchar 50), `name` (100, nullable), `typeId` (código del catálogo, texto libre), `code` (**único global**), `icon`, `countryCt`, `regionCt`, `cityCt`, `address`, `addressStreet/PostalCode/City/Country`, `gpsCoordinates`, `hours` (JSON), `phone`, `notes`, **`officeDependencyId`** (padre, autorreferencia), `softDelete`, `status`, `updatedAt` (Float, cursor de sync) | `prisma/schema.prisma:99-136` |
| `user_office` | `id`, `userId`, `officeId`, `softDelete`, `status` — **N:M usuario↔oficina** | `schema.prisma:138-152` |
| Catálogo `OFFICE_TYPE` | Ítems semilla: HQ, REGIONAL_OFFICE, HOSPITAL, CLINIC, PHARMACY, LABORATORY, ADMINISTRATIVE, WAREHOUSE, FIELD_OFFICE, OTHER; el administrador los edita en `/admin/catalogs` | `prisma/seed-catalogs.ts:1093-1104`; `components/offices/office-types.ts:5-6` |

Rasgos: **profundidad ilimitada** (solo padre/hijo, sin columna de nivel; el «nivel» es el tipo del catálogo y no restringe jerarquía, ni siquiera valida que un tipo vaya bajo otro: `createOfficeService` solo verifica que el tipo exista, `office.service.ts:164-183,196-218`) · borrado lógico + papelera · el código se normaliza a mayúsculas y es único (`:192-195`).

## 5. Endpoints que usa la vista

Cliente: `lib/api/office.ts` (llamadas con `fetchRenewing`, cookie, CSRF `x-csrf-token` en mutaciones, `:15-35`). Rutas: `app/api/admin/offices/**`.

| Método y ruta | Función | Cliente | Servicio |
|---|---|---|---|
| `GET /api/admin/offices?tree=1` | Árbol completo | `getOfficeTree` `office.ts:71` | `listOfficeTreeService` `office.service.ts:128-135` |
| `GET /api/admin/offices?cursor&limit(≤200)&search` | Lista plana (pickers, 200 para el selector de padre) | `listOffices` `:75-106` | `listOfficesFlatService` `:137-147` |
| `GET /…/offices/:id` | Detalle | `getOffice` `:108` | `getOfficeService` `:149-158` |
| `POST /…/offices` | Crear | `createOffice` `:132` | `createOfficeService` `:185-221` |
| `PUT /…/offices/:id` | Editar | `updateOffice` `:156` | `updateOfficeService` `:223-266` |
| `PUT /…/offices/:id/move` | Reparentar (`parentId` o `null`) con chequeo de ciclo | `moveOffice` `:160` | `moveOfficeService` `:268-297` |
| `DELETE /…/offices/:id` | Borrado lógico | `deleteOffice` `:164` | `deleteOfficeService` `:299-312` |
| `GET /…/offices/trash`, `POST …/:id/restore` | Papelera | `getTrash`, `restoreOffice` `:168-174` | — |
| `GET /…/offices/:id/stats` | Conteos (beneficiarios, documentos, contactos, usuarios, hijos) | `getOfficeStats` `:184` | — |
| `GET /…/offices/:id/relations?entity&cursor&limit` | Registros vinculados paginados | `getOfficeRelations` `:204` | `office.service.ts:402-409` |
| `GET /…/offices/:id/history` | Auditoría | `listOfficeHistory` `:223` | — |
| `POST /api/admin/users/:id/offices` · `DELETE …/:id/offices/:officeId` | Asignar / quitar oficina a un usuario | `addUserOffice` / `removeUserOffice` (`RolesPermissionsTab.tsx:15-16`) | `assignOfficeService` `admin-user.service.ts:372-394` (+ historial `recordUserAssignment`) |

Esquema de validación: `server/http/schemas/office.ts:37-57` (Zod `.strict()`; código `^[a-zA-Z0-9_-]+$`, máx. 50).

## 6. Reglas de comportamiento (las que se notan en pantalla)

- **Expansión inicial**: abre los 2 primeros niveles una sola vez (`office-tree-client.tsx:101-109`). Atajos: `/` enfoca el buscador; dígitos 0-9 fijan el nivel visible (`:137-154`).
- **Búsqueda cliente**: coincide con nombre, código, ciudad o etiqueta del tipo; muestra coincidencias **más sus ancestros**, auto-expande, y al limpiar **restaura** el estado de expansión previo (`hooks/useTreeState.ts`, `filteredIds`, `:120-170` aprox.).
- **Mover por arrastre**: si la oficina tiene beneficiarios o usuarios activos, pide confirmación con los conteos antes de mover (`:202-232`; texto `tree.moveConfirm` en `messages/es/dashboardPages.json`). Errores mapeados: ciclo, padre inexistente, con dependientes, 403 (`:54-64`).
- **No se puede deshabilitar ni borrar** una oficina con usuarios activos, beneficiarios no borrados o hijas activas; la API responde 409 `office_has_dependents` con el desglose (`office.service.ts:117-126,238-241,309`).
- **Borrar es idempotente** (borrar lo ya borrado no falla, `:305-307`).
- **Mover exige escribir en origen y destino**: padre actual y nuevo padre, o `office:*` si el destino es la raíz (`:277-283`).
- **Estados vacíos**: árbol vacío «No se encontraron oficinas. Añade la primera.» con botón (`:456-465`); sin resultados de búsqueda con botón «Limpiar» (`:444-453`); papelera vacía; relaciones vacías; historial sin entradas (`office-detail-client.tsx:332-334`); 404/403 de detalle con enlace «← Volver a oficinas» (`:132-161`).

## 7. Permisos y alcance

| Aspecto | Hecho | Fuente |
|---|---|---|
| Acceso a la sección | Solo admin; se aplica **en el servidor** (Casbin), no en la página; el enlace vive en el menú admin | `app/(dashboard)/admin/AGENTS.md` «Access»; `nav-config.ts:151` |
| Escribir oficinas | Política Casbin `office:*` `write`; el rol `admin` la tiene, y también `office:<id>` `write` por oficina. **La pertenencia no da permiso de escritura** | `office.service.ts:87-106`; `prisma/seed-casbin.ts:24-25` |
| Crear | Exige `office:*` `write` (no hay oficina de contexto), tanto raíz como hija | `office.service.ts:189` |
| Leer | `office:*` `read` ve todo; si no, solo las oficinas directas del usuario (`ctx.user.officeIds`) | `:128-158` |
| Alcance de datos por oficina | Un usuario ve datos de sus oficinas **más todas las descendientes** (CTE recursiva); quien tiene acción `admin` sobre el recurso no se filtra | `server/auth/office-scope.ts:30-47` |
| Asignar usuarios | `requireUserWrite` (permiso de escritura de usuarios), no el de oficinas | `admin-user.service.ts:372-377` |
| Selector de oficina en el shell | Selector **solo en el menú no-admin** y solo para quien tiene **más de una oficina directa**; es una preferencia de sesión en memoria que el servidor valida (`narrowOfficeScope`); `null` = «todas mis oficinas» | `components/AppShell/OfficeFilterContext.tsx:1-59`; `Sidebar.tsx:494-519` |

## 8. Hallazgos (T1)

### H-gal-01 · Gallium es un único tenant con árbol de padre-hijo ilimitado
- Clase: VERIFICADO
- Evidencia: `prisma/schema.prisma:99-136` (`officeDependencyId`, sin columna de cuenta, `@@unique([code])`); `office.service.ts:196-199` (la creación solo exige que el padre exista) · 2026-11-02
- Hecho: la jerarquía es una lista de adyacencia sin tope de profundidad; «nivel» no existe como columna.
- Implica para la épica: encaja con R1 (flexible), pero el modelo de Kobrax necesita `account_id` y código único por cuenta, no global.
- HUB: —

### H-gal-02 · El «tipo» de oficina es un catálogo administrable, no una regla de nivel
- Clase: VERIFICADO
- Evidencia: `components/offices/office-types.ts:5-31`; `prisma/seed-catalogs.ts:1093-1104`; `office.service.ts:164-183` · 2026-11-02
- Hecho: el tipo es el código de un ítem de catálogo `OFFICE_TYPE`; el color del badge sale de un hash del código; nada impide poner cualquier tipo bajo cualquier padre.
- Implica para la épica: replicar R1 con nombres de nivel/tipo configurables tiene precedente directo; Kobrax ya tiene catálogos (`CatalogType`), por verificar si sirve el mismo mecanismo.
- HUB: —

### H-gal-03 · La relación usuario↔oficina es N:M
- Clase: VERIFICADO
- Evidencia: `schema.prisma:138-152` (`user_office`); `RolesPermissionsTab.tsx:148-195`; `OfficeFilterContext.tsx:1-14` · 2026-11-02
- Hecho: un usuario puede tener varias oficinas; la asignación vive en el detalle del usuario, no en la pantalla de oficinas.
- Implica para la épica: coincide con R3. En Kobrax hoy es una sola oficina por persona y cuenta (`branchId?` + `@@unique([userId, accountId])`, L-02), así que «igual que Gallium» exige cambiar el modelo.
- HUB: —

### H-gal-04 · Inconsistencia interna de Gallium: árbol visible sin descendientes, datos con descendientes
- Clase: VERIFICADO
- Evidencia: `office.service.ts:128-135` y `office.repository.ts:64-65` (`id IN officeIds`, sin expandir) vs `server/auth/office-scope.ts:30-47` (expande descendientes) · 2026-11-02
- Hecho: un usuario sin `office:*` read ve en el árbol y la lista solo sus oficinas directas, mientras que los datos que consulta sí abarcan toda la rama.
- Implica para la épica: «igual que Gallium» no debe copiar este desajuste; R4 (la regional cubre su subárbol) necesita árbol y alcance coherentes.
- HUB: —

### H-gal-05 · Crear y mover oficinas exige un permiso global; la asignación de usuarios, otro
- Clase: VERIFICADO
- Evidencia: `office.service.ts:87-106,189,277-283`; `admin-user.service.ts:377` · 2026-11-02
- Hecho: crear requiere `office:*` write (admin); la membresía no otorga escritura; asignar personas requiere el permiso de usuarios.
- Implica para la épica: consistente con R5 (solo super admin crea). Para Kobrax el permiso actual es `account:write` (L-08), que no es exclusivo del super admin.
- HUB: —

### H-gal-06 · Reglas de integridad al deshabilitar, borrar y mover
- Clase: VERIFICADO
- Evidencia: `office.service.ts:117-126,238-241,277-297,299-312` · 2026-11-02
- Hecho: bloqueo (409) si hay usuarios activos, beneficiarios o hijas activas; chequeo de ciclo al mover; confirmación en la UI cuando hay datos asociados.
- Implica para la épica: Kobrax ya bloquea la baja con miembros activos (`branches-manager.tsx:291,300`) pero no considera créditos ni hijas.
- HUB: —

### H-gal-07 · Valores fijos en la UI de Gallium que no deben copiarse
- Clase: VERIFICADO
- Evidencia: `TreeNode.tsx:137` (omite país «United States»); `OfficeForm` y `NodePreviewDialog` etiquetan «Beneficiarios/Documentos» como relaciones de negocio de Gallium (`OfficeRelations.tsx:22-35`) · 2026-11-02
- Hecho: parte de la vista (relaciones, estadísticas, ciudad/país) está atada al dominio de Gallium (beneficiarios, documentos, contactos).
- Implica para la épica: en Kobrax las relaciones equivalentes serían usuarios, créditos y clientes; no hay «contactos/documentos» de oficina.
- HUB: —

### H-gal-08 · Partes no construidas o inactivas en Gallium
- Clase: VERIFICADO
- Evidencia: `admin/offices/AGENTS.md` «Deferred / known»: carga perezosa del árbol (>200 oficinas) no construida, clustering del mapa omitido, `subscribe:office` por WebSocket inactivo · 2026-11-02
- Hecho: la referencia no cubre árboles grandes ni tiempo real.
- Implica para la épica: para un tenant grande de Kobrax el árbol de Gallium no está probado más allá de ~200 oficinas.
- HUB: —

### H-gal-09 · El diálogo de edición y el formulario completo están marcados como deuda
- Clase: VERIFICADO
- Evidencia: `components/offices/AGENTS.md` («Frozen debt, not the pattern to copy» para `OfficeForm`) · 2026-11-02
- Hecho: el propio Gallium dice que `OfficeForm.tsx` (RHF+Zod a mano) no es el patrón a copiar; lo nuevo va como esquema `Ga10Form`.
- Implica para la épica: replicar la estructura y comportamiento, no el código del formulario.
- HUB: —

## 9. Qué hay que replicar para que la vista sea igual (R7)

Lista de elementos observables; cada uno se contrasta con el modelo de Kobrax en `target/04-experiencia-web.md`.

1. **Ruta propia de sección** de oficinas con título, acciones «Papelera» y «Añadir oficina».
2. **Conmutador Árbol / Mapa**, árbol por defecto. (El mapa depende de que las oficinas tengan GPS; Kobrax hoy no guarda coordenadas de agencia: `BranchRow` no las tiene, `lib/branches.ts:4-15`.)
3. **Árbol** con: expandir/colapsar (Alt/Shift para toda la rama), icono, nombre, ciudad, badge de tipo, badge de código, punto de estado, contador de hijos, menú ⋮.
4. **Barra de herramientas**: buscador (con `/` y Esc), contador, control de nivel (−/+/todo/nada y atajos de teclado 0-9), búsqueda que muestra ancestros y restaura la expansión.
5. **Arrastrar para reorganizar** con zona «nivel superior», confirmación con conteos y mensajes de error de ciclo/dependientes.
6. **Menú de acciones**: Editar · Añadir hija · Alta rápida · Ver detalle · Eliminar con confirmación.
7. **Vista previa** al hacer clic (ruta de ancestros, campos, conteos, Editar / Detalles completos).
8. **Alta rápida** (código, nombre, tipo) y **formulario completo** de 3 pestañas con padre y tipo en desplegables.
9. **Detalle**: hero, enlace al superior, información general, estadísticas, sub-oficinas, relaciones por pestañas con paginación, horario, historial de auditoría bajo demanda, restaurar.
10. **Papelera** con restaurar.
11. **Estados vacíos y de error** descritos en §6.
12. **Asignación de usuarios** desde el usuario (lista + añadir con dropdown filtrable + quitar), con registro de movimiento.
13. **Selector de oficina en el shell** para quien tiene varias (preferencia de sesión validada por el servidor).
14. **Ruta completa visible** (R10): Gallium ya muestra la ruta de ancestros en la vista previa (`NodePreviewDialog.tsx:84,136-138`, separador « / ») pero **no** en el listado ni en el detalle; Kobrax debe mostrarla siempre (R10 pide «Central › Chuquisaca › Central»).

Lo que Kobrax exige y Gallium no tiene (no es «igual», es adaptación): `account_id` en todo; código por cuenta; RLS (B1/B2); rol por asignación (R8); super admin como único creador (R5) frente al permiso `account:write`; perfil gratuito sin árbol (C2/ADR-0004); móvil offline (Gallium sincroniza con `office` como entidad de solo lectura, `lib/api/office.ts:80-99`).

## 10. Contradicciones y desconocidos

| # | Tipo | Detalle |
|---|---|---|
| G-D1 | DESCONOCIDO | Qué hace `role.officeType` (JSON en `schema.prisma:~160`): sugiere roles por tipo de oficina. No se leyó su uso. Pregunta: ¿restringe qué roles se pueden dar en oficinas de cierto tipo? Responde: lectura de `server/**` por quien haga `target/04` si resulta relevante para R8. |
| G-D2 | NO VERIFICADO | La vista de mapa (selección de marcadores, popups) solo se leyó el encabezado; el comportamiento fino está en `office-map-client.tsx:60-470`. |
| G-D3 | NO VERIFICADO | Estilos exactos (`offices.css`, 785 líneas): no se transcribieron colores ni medidas; se sabe que los nombres de clase son contrato e2e (`tree-row`, `tr-toggle`, `tr-action`, `tree-search-input`, `tree-filter-banner`). |
| G-D4 | DESCONOCIDO | Cuántas oficinas maneja un despliegue real de Gallium (el árbol sin carga perezosa asume <200). Responde: la usuaria. |

## Resumen (≤15 líneas)

1. **Qué es Gallium en oficinas:** `/admin/offices`, un árbol padre-hijo de profundidad ilimitada (tabla `office`, `officeDependencyId`), tipos desde un catálogo `OFFICE_TYPE`, relación usuario↔oficina N:M (`user_office`), borrado lógico con papelera y alcance de datos = oficinas propias + descendientes.
2. **Pantalla:** conmutador Árbol/Mapa, árbol con buscador, control de nivel, arrastrar-y-soltar, menú ⋮, vista previa, alta rápida, formulario de 3 pestañas, detalle con estadísticas y relaciones, historial y papelera.
3. **Asignar personas** se hace desde el usuario, no desde la oficina; hay un selector de oficina en el shell para quien tiene varias.
4. **Lo que cuadra con los requisitos:** R1 (tipo configurable, sin tope de niveles), R3 (N:M), R4 (alcance con descendientes), R5 (crear exige permiso global).
5. **Reutilizable de Kobrax web (por patrón, no por código):** `Modal`, `Section`, `Badge`, `EmptyState` (`panel-ui`), `Button/Field/Input/Select` (`ui`), `DataTable`+filtros por URL, `usePermissions`, `sendJson`/BFF, `toast`, `BranchesManager` como base de listado/alta/miembros, `memberLabel/membersOf/candidatesFor`.
6. **No existe en Kobrax web y hay que construir:** árbol recursivo con DnD, control de nivel, vista previa, detalle de oficina, papelera, selector de oficina en el shell, mapa.
7. **Riesgo 1:** Gallium usa Next 16 + PrimeReact + React Query y Kobrax Next 14 + Tailwind sin React Query ni PrimeReact (`apps/web/package.json`): no se copia código, se reimplementa el comportamiento.
8. **Riesgo 2:** Gallium no tiene multi-tenant ni RLS; Kobrax sí, y su `Branch` hoy es plana con una sola oficina por persona (L-01, L-02).
9. **Riesgo 3:** el desajuste de Gallium (árbol sin descendientes vs datos con descendientes, H-gal-04) no debe heredarse.
10. **Riesgo 4:** partes de la vista están ligadas al dominio de Gallium (beneficiarios, documentos, contactos, país por defecto) y deben mapearse a usuarios, créditos y clientes.
