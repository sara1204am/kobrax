# CUENTA · S1 — Hub, datos de la cuenta y mi perfil

> Primer slice con pantalla del módulo. Consume lo que dejó [00-fundacion.md](./00-fundacion.md).
> Índice y decisiones: [README.md](./README.md).

## 1. Objetivo

Que el dueño vea y edite **los datos de su negocio** (razón social, NIT, país+moneda) y **su propio perfil**
(nombre, teléfono, foto) sin salir del móvil. Es el slice que vuelve visible el módulo y valida la parity
visual antes de invertir en lo caro (S2).

## 2. Rama

`f10/cuenta-s1` (sale de `f10/cuenta-fundacion`, que todavía no está en `main`).

## 3. Build

🟢 — Expo Go. `expo-image-picker` ya está instalado y la foto de perfil reusa el mismo camino que la
fachada del cliente. Cero deps nuevas.

## 4. Pantallas

**Sin Figma** (el módulo no tiene diseño — README, encabezado). La referencia es la **parity con las
pantallas ya construidas**: mismo `Header`, mismas `ListRow`, mismos tokens, mismo esqueleto
loading/offline/error.

| Pantalla | Ruta | Qué tiene |
|---|---|---|
| Hub de cuenta | `app/cuenta/index.tsx` | 3 filas: Mi perfil · Datos de la cuenta · Miembros (`N de M`, **deshabilitada hasta S2**) |
| Datos de la cuenta | `app/cuenta/datos.tsx` | Razón social · NIT · País y moneda (un selector) · zona horaria en lectura |
| Mi perfil | `app/cuenta/perfil.tsx` | Foto · nombre · apellido · teléfono · email y rol en lectura |

**Entrada:** la sección **Cuenta** de `app/(tabs)/mas.tsx` ya existe (`mas.tsx:61`) y su fila
"Perfil y seguridad" tiene `onPress={() => {}}` — un placeholder muerto. S1 lo cablea al hub.
**No se agrega una entrada nueva al menú.**

## 5. Contrato

Todo construido en S0, nada nuevo del lado API:

| Pantalla | Llamadas |
|---|---|
| Hub | `GET /api/accounts/me` (para `memberCount` / `maxUsers` de la fila de Miembros) |
| Datos | `GET /api/accounts/me` · `PATCH /api/accounts/me` |
| Perfil | `GET /api/users/me/profile` · `PATCH /api/users/me/profile` · `POST /api/uploads` (foto) |

⚠️ **`PATCH` manda sólo los campos que cambiaron.** El `ValidationPipe` corre con
`forbidNonWhitelisted: true`: reenviar el objeto que devolvió el `GET` (que trae `planCode`, `maxUsers`,
`memberCount`…) es un **400**, no un no-op. El formulario arma el payload por diferencia — patrón que ya
existe en `src/cliente-diff.ts`.

## 6. Decisiones del slice

### S1-D1. País y moneda son **un solo selector**, no dos
Están acoplados en el producto (`SUPPORTED_CURRENCIES` de shared ya lleva el `locale`: `es-BO` → `BO`).
Ofrecer dos listas independientes invita a la combinación imposible (Bolivia + peso mexicano). Una lista de
6 filas — "Bolivia · Bs." — que setea los dos campos en el mismo `PATCH`.

### S1-D2. La zona horaria **se muestra, no se edita**
`Account.timezone` existe y el DTO de S0 lo acepta, pero un selector de zonas horarias es la pieza más
pesada de la pantalla para el caso menos frecuente (un tenant no se muda de huso). Se pinta en lectura.
`ponytail:` techo conocido — cuando un tenant real lo pida, el endpoint ya está y es agregar el selector.

### S1-D3. `SelectRow` y `PickerSheet` **suben a `ui.tsx`**
Hoy viven dentro de `app/agenda/crear.tsx` (`:717` y `:777`) y el propio código dice *"Sube a `ui.tsx`
cuando S3/S4 la pidan"*. S1 es el segundo consumidor real → se suben con sus estilos, y `agenda/crear.tsx`
pasa a importarlos. **No se copia el patrón a `datos.tsx`**: eso es el anti-patrón explícito del skill.
`Multiline` y `ReadOnlyField` **se quedan** donde están: S1 no los usa.

### S1-D4. Editar la cuenta se gatea por capacidad, el perfil no
`account:write` decide si `datos.tsx` es editable o de sólo lectura (un `SUPERVISOR` que entra ve sus datos
y no puede tocarlos). El perfil **no se gatea**: es de uno mismo y el endpoint tampoco lo exige.
Nunca por `accountType` ni por `planCode` (README D6).

### S1-D5. Sin conexión, se ve pero no se guarda
Administrar la cuenta no es una acción de campo (README §8). Con la red caída la pantalla carga de la
última respuesta si la hay, muestra el `OfflineIndicator` que ya existe, y el botón de guardar queda
deshabilitado con el motivo escrito. **No se construye cola de sync.**

## 7. Auditoría de reuso

| Capacidad | Decisión | Path |
|---|---|---|
| Red, envelope, refresh 401 | **REUSAR** | `src/api-client.ts` → `apiQuery` / `apiMutate` |
| Forma del service | **REUSAR patrón** | `src/clients.service.ts` (thin sobre `apiQuery`/`apiMutate`) |
| Chrome, filas, secciones, vacíos, hoja | **REUSAR** | `src/ui.tsx` → `Header`, `ListRow`, `SectionLabel`, `EmptyState`, `BottomSheet`, `OfflineIndicator` |
| Inputs, botón, banner de error | **REUSAR** | `src/components.tsx` → `Field`, `Button`, `ErrorBanner` |
| **Payload por diferencia** (sólo lo que cambió) | **REUSAR patrón, NO la función** | `src/cliente-diff.ts` resuelve un problema distinto: sub-recursos (teléfonos, ubicaciones, garantes) con altas/bajas por fila (`RowOps`). Acá son **3 campos escalares** → un diff de ~5 líneas en `account-form.ts`. Se copia la idea (puro, testeable, sin cambios = sin llamada), no el código |
| **Etiqueta del rol** | **REUSAR** | `ROLE_LABEL` de `@kobrax/shared` — la razón por la que S0 sacó `roleLabel` del payload |
| **Monedas y países** | **REUSAR** | `SUPPORTED_CURRENCIES` de `@kobrax/shared` (nombre, símbolo y `locale` → país). **No se instala nada de i18n** |
| Identidad y permisos de la sesión | **REUSAR** | `src/auth-service.ts` → `Me` (`profile`, `role`, `permissions`) |
| Elegir foto (cámara/galería) | **REUSAR** | `src/photo.ts` → `choosePhoto()` |
| Subir la foto | **REUSAR** | `src/uploads.service.ts` |
| Estado de conectividad | **REUSAR** | `src/store/net.ts` → `useNetStore` |
| Tokens | **REUSAR** | `src/theme.ts` — nada hardcodeado |
| **`SelectRow` + `PickerSheet`** | **SUBIR a `ui.tsx`** | hoy en `app/agenda/crear.tsx:717` y `:777`, con sus estilos. `agenda/crear.tsx` pasa a importarlos (S1-D3) |
| `src/account.service.ts` | **NUEVO** | thin sobre `apiQuery`/`apiMutate`, un archivo para `accounts` + perfil (`users/me/profile`). No dos: son la misma pantalla de ajustes |
| `src/account-form.ts` | **NUEVO** | validación pura + payload por diferencia, testeable sin red (patrón `cliente-form.ts` + `cliente-diff.ts`) |

**Cero dependencias nuevas. Cero endpoints nuevos.**

## 8. Tareas

1. Subir `SelectRow` + `PickerSheet` (y sus estilos) a `src/ui.tsx`; `agenda/crear.tsx` los importa.
   Verificar que agenda sigue compilando y sus tests pasan **antes** de seguir.
2. `src/account.service.ts`: `getAccount`, `updateAccount`, `getMyProfile`, `updateMyProfile`.
3. `src/account-form.ts` + su test: validación (razón social ≥2, teléfono) y `diff()` del payload.
4. `app/cuenta/index.tsx` (hub) + cablear `mas.tsx`.
5. `app/cuenta/datos.tsx`.
6. `app/cuenta/perfil.tsx`.
7. Verificación (§10).

**Orden:** la subida a `ui.tsx` primero (es la que puede romper algo ya mergeado, y conviene saberlo
temprano); después datos/servicios; las pantallas al final, leer antes que escribir.

## 9. Reglas de fase

Las 3 del epic §3.3 (sol→contraste · gama baja→perf en UI thread · animación con propósito) + las del
README §8, y las de este slice:

- **El `PATCH` va por diferencia, nunca el objeto entero** (§5). Es un 400, no un detalle de estilo.
- **Gating por capacidad** (`me.permissions`), nunca por `accountType`/`planCode`.
- **Sin cola de sync**: la excepción documentada a offline-first (S1-D5).

## 10. DoD

- Las 3 pantallas navegan desde `Más` y pintan datos reales del tenant.
- Editar razón social / país+moneda / perfil persiste y se ve al volver a entrar.
- Con `account:write` ausente, `datos.tsx` es de sólo lectura (probable con `supervisor@kobrax.demo`).
- Sin red: se ve el banner, el guardar está deshabilitado, la app **no** se rompe.
- `pnpm --filter @kobrax/mobile type-check` · `test` — **base medida en esta rama: 162 pass / 19 suites**.
  ⚠️ El "166" es de `f10/rutas-s3-preview`, no de acá (mismo error que con los 361 de la API).
- `npx expo export --platform android`.
- `pnpm --filter @kobrax/api test` sigue verde (la subida a `ui.tsx` no toca API, pero agenda sí se tocó).
- `/code-review` + `/ponytail-review`.
- **Validación visual de la usuaria** en el teléfono — la app no corre headless
  ([[kobrax-mobile-verify-limits]]).

## 11. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| S1-R1 | **Subir `SelectRow`/`PickerSheet` rompe `agenda/crear.tsx`**, que ya está mergeada y funcionando | Es la tarea 1 justamente para verificarlo temprano: type-check + los tests de agenda antes de escribir una pantalla nueva |
| S1-R2 | El `PATCH` con el objeto completo devuelve 400 y parece "no guarda" | El payload sale de `diff()` y el test de `account-form` lo cubre |
| S1-R3 | La foto de perfil dispara el reinicio de Expo Go en gama baja | Ya conocido y mitigado en `photo.ts`: ofrece Galería además de Cámara |
| S1-R4 | `memberCount` en el hub confunde antes de que exista S2 | La fila de Miembros se pinta **deshabilitada** con "Próximamente", no navega a una pantalla vacía |
