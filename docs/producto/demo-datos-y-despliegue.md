# Kobrax — Datos de demo y despliegue

> Documento derivado **solo del repositorio** (seeds, `infra/`, `.github/`, `apps/*`, `docs/`). No se accedió a la URL
> desplegada ni se usaron credenciales. Todo lo que dependa del estado real del servidor está marcado
> **«no verificable desde el repo»**.
>
> Fecha de redacción: 2026-10-09. Rama de trabajo al redactar: `docs/movil-alineacion-web`.

---

## 1. Qué crean los seeds

Hay un seed principal y dos seeds de datos extra. Todos son datos **ficticios** (documentos `DEMO-xxxx`, teléfonos
de la serie `7000xxxx`, correos `@kobrax.demo` y `@ejemplo.test`).

### 1.1 Seed principal — `packages/database/prisma/seed.ts`

| Comando (desde la raíz) | Qué hace |
|---|---|
| `pnpm db:seed` | Permisos, roles, catálogos y el dataset demo completo. Idempotente: si el dataset ya está, no lo toca. |
| `pnpm db:seed:catalog` | **Solo** permisos y roles (el modo previsto para producción real). Sin datos de demo. |
| `pnpm db:seed:refresh` | Borra el dataset demo de `DEMO` y `DEMO2` y lo vuelve a sembrar con fechas relativas a HOY (zona `America/La_Paz`). |
| `pnpm db:verify:seed` | Comprueba lo sembrado con `prisma/verify/seed-sin-caso.sql`. |

Todas las fechas del seed son **relativas al día en que corre**, nunca fijas. Por eso una demo sembrada hace semanas
muestra agendas vencidas y rutas «de hoy» desactualizadas: hay que correr `db:seed:refresh`.

**Cuentas (tenants)**

| Código | Nombre | Plan | Uso |
|---|---|---|---|
| `DEMO` | Kobrax Demo | `PROFESSIONAL` | La cuenta grande, con todo el dataset. País `BO`, moneda `BOB`. |
| `DEMO2` | Kobrax Demo Norte | `PROFESSIONAL` | Mínima (2 clientes, 2 créditos, 1 cobrador). Solo para probar aislamiento entre empresas. |

**Agencias en DEMO**: `CEN` Agencia Central (La Paz, gerente de agencia: Sandra) y `ALT` Agencia El Alto (gerente: María).
En DEMO2: `NOR` Agencia Norte.

**Usuarios** (la contraseña única de todos los usuarios del seed está escrita en `packages/database/prisma/seed.ts`,
en el bloque `bcrypt.hash(...)` de la sección «Agencias, usuarios y membresías»; **no se reproduce aquí**).

| Rol (`RoleType`) | Correo | Notas |
|---|---|---|
| `ACCOUNT_ADMIN` (dueño) | `owner@kobrax.demo` | Rol crítico: exige MFA (`CRITICAL_ROLES` en `auth.service.ts`). |
| `MANAGER` | `manager@kobrax.demo` | Gerente. |
| `MANAGER` (multiempresa) | `multi2@kobrax.demo` | También miembro de DEMO2 como `MANAGER`. |
| `SUPERVISOR` | `supervisor@kobrax.demo` (Sandra, CEN) | Supervisa cobradores de CEN. |
| `SUPERVISOR` (multiempresa) | `multi@kobrax.demo` (María, ALT) | Además `ACCOUNT_ADMIN` en DEMO2. |
| `COLLECTOR` | `collector@kobrax.demo` (Carlos, CEN) | El cobrador principal: dueño de la mora «estrella» y de la ruta de hoy. |
| `COLLECTOR` | `cobrador1@` y `cobrador2@kobrax.demo` (CEN), `cobrador3@` y `cobrador4@kobrax.demo` (ALT) | Con créditos y rutas. |
| `COLLECTOR` | `cobrador5@` … `cobrador10@kobrax.demo` | Sin créditos propios a propósito: sirven para probar login, bloqueo y desbloqueo (QA manual). |
| `COLLECTOR` (DEMO2) | `cobrador.norte@kobrax.demo` | Solo en DEMO2. |

Los roles `AUDITOR`, `VIEWER` y `SUPER_ADMIN` existen en el catálogo (`role.enum.ts`) pero **el seed no crea usuarios
con esos roles**.

**Volumen aproximado en DEMO** (según `seed.ts`; los pagos, gestiones y agendados se calculan en tiempo de ejecución
y el log del seed los imprime):

| Dato | Cantidad |
|---|---|
| Clientes | 25 (`DEMO-0001` … `DEMO-0025`) |
| Créditos creados «en la app» | 17 (`CRD-DEMO-0001` … `0017`), con cronograma y pagos; entre ellos 2 pagados totalmente y 1 castigado |
| Créditos «importados de PSF» | 6 (para mostrar la fuente externa, el ausente del reporte, etc.) |
| Crédito «estrella» | `CRD-DEMO-0001` (cliente Lidia Mamani, 47 días de mora, 3 episodios de mora de los cuales 2 cerrados, categoría B, ficha completa: garante, familia, garantías, notas, 7 secciones de post-it, promesas, responsables de apoyo y temporal) |
| Rangos de mora | Al día, 12, 21, 28, 38, 75, 130 y 240 días (el de 240 días está castigado) |
| Categorías de mora | A 1–30, B 31–60, C 61+ (por cuenta) |
| Rutas | ~17 jornadas de distintos cobradores: hoy en curso (Carlos, Rosa, Julia), ayer y días previos completadas, 1 cancelada, y planificadas para mañana y pasado |
| Visitas | Las paradas visitadas generan visitas de campo con resultado (pagó, promesa, pago parcial, sin contacto, contactado), con foto y/o firma |
| Evidencia | Una foto mínima real escrita en disco (`UPLOADS_DIR` o `apps/api/uploads/<accountId>/<sha>.jpg`) y firmas; con su hash SHA-256 |
| Pagos | Cronogramas con cuotas pagadas, pagos parciales y un cobro de hoy (`CRD-DEMO-0009`, parcial en efectivo) |
| Otros | Notas post-it, notificaciones, historial de importaciones (4 corridas A–D) con sus fotos |

El seed garantiza exactamente **un** agendado vencido (`assertAgenda`).

### 1.2 Seeds extra (opcionales, no los llama `db:seed`)

Se corren a mano contra la cuenta `DEMO` ya sembrada. No están en `package.json`; el comando va en el encabezado de cada archivo.

| Archivo | Qué deja | Comando |
|---|---|---|
| `packages/database/prisma/seed-demo-rutas.ts` | Para probar el wizard «Planificar ruta» y el mapa: 9 clientes de Diego Mamani (`cobrador6@`) con 10 créditos en mora (3–90 días), 5 clientes de Carlos sin ruta cerca de las paradas (visitas preventivas), 2 visitas agendadas para mañana. Prefijo `DEMO-DM-`. Idempotente. | `pnpm --filter @kobrax/database exec tsx --env-file=../../.env prisma/seed-demo-rutas.ts` |
| `packages/database/prisma/seed-demo-sucre.ts` | Cobrador Álvaro Terrazas (`cobrador.sucre@kobrax.demo`) con 8 clientes en mora en Sucre, 2–4 ubicaciones por cliente y 6 visitas agendadas para mañana. Prefijo `DEMO-SU-`. Idempotente. | `pnpm --filter @kobrax/database exec tsx --env-file=../../.env prisma/seed-demo-sucre.ts` |
| `packages/database/prisma/seed-perf.sql` | Datos masivos de rendimiento. | No documentado aquí (script SQL de pruebas de carga). |

### 1.3 Archivos de muestra de importación

El repo **no trae plantillas CSV/XLSX**. Sí trae extractos PDF de ejemplo (formato del banco, «reporte de mora»):

- `docs/flows/psf-diario/Reporte_Mora_20260928_CQE.pdf`, `…0929…`, `…0930…`, `…20261001…`, `…20261002…` (serie diaria de 5 días).
- `docs/flows/mora union.PDF`, `docs/flows/mora_10_registros.pdf`, `docs/flows/Cliente_Prestamo.pdf`.

El importador web (`/import`) acepta `.csv`, `.txt`, `.pdf`, `.xlsx` y `.xls` (`ACCEPTED_FILES` en `apps/web/src/lib/import.ts`).
La API los parsea con `apps/api/src/modules/imports/parsers/` (PDF por filas, PDF por bloques, filas de hoja de cálculo).

> No verificable desde el repo: si esos PDF contienen datos reales o anonimizados. El plan `docs/epics/F10/plans/import/README.md`
> dice que el extracto lo emite el banco; **conviene revisar que no tengan datos reales antes de compartir el repo.**

---

## 2. Empezar desde cero

### 2.1 Registro de una cuenta nueva (`/registro`)

Pantalla: `apps/web/src/app/(auth)/registro/page.tsx` → `POST /api/auth/registro` → `POST /accounts` (`accounts.service.ts#create`).

1. **Paso 1: elegir plan** entre `FREE`, `PROFESSIONAL` y `BUSINESS` (`SIGNUP_PLANS`). `ENTERPRISE` no se puede elegir en el alta.
2. **Paso 2: datos**: nombre del negocio, nombre, apellido, correo y contraseña (validada por `isPasswordValid`).
3. Qué se crea, en una sola transacción con contexto RLS:
   - Una `Account` tipo `INDEPENDENT`, país y moneda por defecto del mercado (se cambian después en `/cuenta`).
   - Si el plan es `FREE`: estado `ACTIVE`. Si es pago: estado `TRIAL` con `settings.trialEndsAt` a **30 días** (`TRIAL_DAYS`); al vencer la cuenta sigue en `FREE`.
   - Un `User` con su perfil, ya `ACTIVE`, y la membresía como **dueño** (`isOwner`, `isDefault`) con rol `ACCOUNT_ADMIN`.
   - Las 3 categorías de mora por defecto (A/B/C).
   - Una fila de auditoría.
   - **No** crea clientes, créditos, agencias, rutas ni cobradores: la cuenta queda vacía.
4. El alta no devuelve tokens: la web hace el login y, como el rol es `ACCOUNT_ADMIN`, **aterriza en el enrolamiento de MFA** (obligatorio para ese rol).
5. Requisito de la base: el catálogo de roles debe existir (`pnpm db:seed:catalog` o el seed completo). Sin eso el registro responde `ROLE_CATALOG_MISSING`.

Límites de la cuenta vacía según plan (`packages/shared/src/constants/plans.ts`):

| Plan | Usuarios | Créditos | Clientes | Fotos/mes | Acciones/mes |
|---|---|---|---|---|---|
| FREE | 1 | 20 | 20 | 100 | 100 |
| PROFESSIONAL | 25 | 1000 | 1000 | 5000 | 2500 |
| BUSINESS | 100 | 5000 | 5000 | 25000 | 12500 |

### 2.2 Cargar datos desde cero

| Vía | Dónde | Qué permite |
|---|---|---|
| Alta manual de cliente | Web `/cartera` → botón de nuevo cliente (`new-client-button.tsx`); API `POST /clients`, con `POST /clients/duplicate-check` para evitar duplicados | Cliente con contactos, ubicaciones, relaciones, garantías y adjuntos (`/clients/:id/contacts`, `/locations`, `/relations`, `/collaterals`, `/attachments`). |
| Alta manual de crédito | Web `/cartera/[id]/prestamo` (`loan-form.tsx`); API `POST /credits` | Crédito con cronograma; la mora se calcula sola. |
| Importación de cartera | Web `/import` (y módulo Import del móvil); API `POST /imports/portfolio`; configuración en `/import/ajustes` | Sube el extracto (PDF/CSV/XLSX/TXT), muestra **vista previa** (agregados, actualizados, puestos al día) y confirma. Antes de la primera importación hay que **calibrar** en Ajustes cuál columna es los días de mora (regla `CALIBRATION_STALE`). Historial por corrida en `/import`. |
| Importación de clientes por CSV | `apps/api/src/modules/clients/import/` (`POST /clients/imports`) | Solo escribe clientes (no créditos). |
| Equipo | `/equipo` → invitar (código de invitación; `/invitacion` en la web) | Alta de cobradores/supervisores. |

No hay «plantilla descargable» en el repo: el formato esperado está descrito en `docs/epics/F10/plans/import/FIELD-RULES.md`.

### 2.3 Restaurar o resetear la demo

Scripts reales (nada de esto lo ejecuta el CI):

| Necesidad | Comando | Efecto | Riesgo |
|---|---|---|---|
| Renovar fechas y datos demo | `pnpm db:seed:refresh` | Borra solo lo operativo de `DEMO` y `DEMO2` y lo vuelve a sembrar | Bajo; pero **borra lo que se haya cargado a mano en esas dos cuentas** |
| Sembrar si falta | `pnpm db:seed` | No duplica | Ninguno |
| Dejar solo catálogo | `pnpm db:seed:catalog` | Permisos y roles | Ninguno |
| Recrear toda la base | `pnpm --filter @kobrax/database db:rebuild --force` (`prisma/rebuild.ts`) | Borra el esquema `public`, aplica migraciones y RLS y siembra (`--no-seed` para no sembrar) | **Destructivo**: borra TODO, incluidas las cuentas creadas por registro |
| Volver a un respaldo | Archivos `kobrax-<fecha>-pre-<commit>.sql.gz` en `/opt/kobrax/backups` del servidor (los crea `deploy.sh`) | Restaurar con `gunzip` + `psql` | **No hay script de restauración en el repo.** No verificable desde el repo que se haya probado |

Notas:
- `prisma migrate reset` y `migrate dev` **no funcionan** en este repo (las migraciones dependen de `app_current_account()`, que define `rls/001_enable_rls.sql`); por eso existe `db:rebuild` y `rls-bootstrap.sql`.
- En el servidor, `seed.ts` necesita `DATABASE_URL` del rol dueño del esquema (no `kobrax_app`).
- Aislamiento: re-sembrar con `--refresh` no toca cuentas creadas por registro.

---

## 3. Dos escenarios de demostración para un evaluador

Los pasos usan solo pantallas que existen en `apps/web/src/app/` (login, registro y panel: `dashboard`, `cartera`,
`mora`, `agenda`, `rutas`, `pagos`, `import`, `equipo`, `cuenta`, `exportar`, `settings`).

### Escenario A — «Cuenta ya poblada» (requiere que la cuenta `DEMO` esté sembrada)

Preparación: `pnpm db:seed:refresh` si los datos tienen más de un par de días (fechas relativas).

1. **Login** en `/login` con `owner@kobrax.demo` (contraseña: ver `seed.ts`). Por ser `ACCOUNT_ADMIN`, la primera vez pedirá enrolar MFA. Si eso estorba para una demo corta, entrar con `manager@kobrax.demo` o `supervisor@kobrax.demo` (no exigen MFA por rol).
2. **`/dashboard`**: KPIs, mapa de visitas de la última jornada con paradas, cobrado y cartera en mora.
3. **`/mora`** (Central de Mora): tabla de créditos en mora con categoría A/B/C y prioridad; abrir `CRD-DEMO-0001` (la «estrella», 47 días) y recorrer su ficha: episodios de mora, garante/familia, garantías, notas post-it, promesas, responsables.
4. **`/cartera`**: lista de los 25 clientes; abrir Lidia Mamani (`DEMO-0001`) y sus dos créditos; ver ubicaciones (hogar y negocio).
5. **`/agenda`**: vista día/semana/mes con tareas de hoy, próximos días y semana siguiente, y el único agendado vencido.
6. **`/rutas`**: jornada de hoy en curso (Carlos, Rosa, Julia): paradas, mapa, fotos de la casa, visor de evidencia (foto/firma) y cambio de dirección de una parada. Jornadas de ayer completadas y planificadas para mañana.
7. **`/pagos`**: pagos registrados, con comprobante, y aprobación.
8. **`/import`**: historial de 4 corridas simuladas con su detalle por corrida.
9. **`/equipo`** y **`/cuenta`**: equipo con 2 agencias, categorías de mora, plantillas de WhatsApp, plan y consumo.
10. **Aislamiento**: con `multi2@kobrax.demo` (membresía en DEMO y DEMO2) se puede cambiar de empresa y ver que DEMO2 no muestra datos de DEMO.
11. **Móvil**: con `collector@kobrax.demo` ver la ruta de hoy (ver §5).

### Escenario B — «Cuenta nueva vacía»

1. **`/registro`**: elegir plan (`FREE` para el recorrido más corto; uno pago da 30 días de prueba), completar los datos.
2. Confirmación del alta y **enrolamiento de MFA** (rol `ACCOUNT_ADMIN`).
3. **`/dashboard`** y **`/cartera`** vacíos (estados vacíos).
4. **`/cartera`** → nuevo cliente (con teléfono y dirección).
5. **`/cartera/[id]/prestamo`** → crear el crédito (monto, cuotas, tasa, fecha): se genera el cronograma.
6. **`/pagos`** → registrar un pago o abonar a una cuota; ver el crédito pasar a «al día».
7. Para ver mora: crear un crédito con primera cuota vencida (o importar). **`/mora`** mostrará el episodio de mora abierto, calculado automáticamente.
8. **`/import`** → **Ajustes** (calibrar la columna de días de mora) y subir uno de los PDF de `docs/flows/psf-diario/` (ver advertencia de §1.3); revisar la vista previa y confirmar.
9. **`/equipo`** → invitar a un cobrador (en FREE el límite es 1 usuario: probar el aviso de límite del plan).
10. **`/rutas`** → planificar ruta con los créditos en mora; requiere ubicaciones con coordenadas (y OSRM para el trazado por calles; ver §4.5).

---

## 4. Arquitectura de despliegue

Fuente: `infra/production/` (README, PASOS-AHORA, scripts), `.github/workflows/deploy.yml`, `docker-compose.yml` (desarrollo).

### 4.1 Topología

```
Internet ─ 80/443 ─► Nginx Proxy Manager (contenedor kobrax-npm, red de host, Let's Encrypt)
                        ├─ kobrax.ikigaisystems.lat      ─► 127.0.0.1:3100  Next.js (systemd: kobrax-web)
                        └─ api.kobrax.ikigaisystems.lat  ─► 127.0.0.1:4010  NestJS  (systemd: kobrax-api)
Docker (docker-compose.prod.yml):  postgres:15-alpine (127.0.0.1:5434) · redis:7-alpine (127.0.0.1:6379)
Docker aparte:  portainer (9443, solo IP permitida)
```

- **No hay Caddy**: el proxy es **Nginx Proxy Manager** (`06-proxy.sh`), con administración en el puerto 81 restringido por IP.
- **La app NO corre en Docker**: API y web son servicios **systemd** (`kobrax-api`, `kobrax-web`) con el código en `/opt/kobrax/app`, Node 20 y pnpm 9.12 (sin pm2).
- El panel web llama a la API por el salto interno `KOBRAX_API_URL=http://127.0.0.1:4010/api`; el **móvil** llama directo a la API pública.
- Servidor: VPS Contabo (8 núcleos, 24 GB), Ubuntu 24.04, IP en `infra/production/README.md`. Dominio `ikigaisystems.lat`, DNS delegado a Vercel (registros `kobrax` y `api.kobrax`).
- Contenedor de base: se crea el rol `kobrax_app` (sin `SUPERUSER` ni `BYPASSRLS`) por `infra/postgres/init/01-create-app-role.sql`; la API corre con ese rol (`APP_DATABASE_URL`) y RLS se aplica; las migraciones y el seed usan el superusuario (`DATABASE_URL`).

### 4.2 Despliegue (CI)

`.github/workflows/deploy.yml`: cada **push a `main`** (o ejecución manual) hace SSH al servidor y corre `/opt/kobrax/deploy.sh`.
Secretos de GitHub requeridos: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`. No hay otros workflows (sin CI de tests).

Pasos de `deploy.sh`: `git reset --hard origin/main` → `pnpm install --frozen-lockfile` → `prisma generate` → `pnpm build` →
`pg_dump` (respaldo previo) → `rls-bootstrap.sql` → `prisma migrate deploy` → archivos `prisma/rls/*.sql` → reinicio de api y web →
verificación de servicios → verificación de firewall (ufw activo y sin permitir 3000/4010/5434/6379).
**El despliegue nunca corre el seed**: la carga de datos de demo en el servidor es manual y no verificable desde el repo.

### 4.3 Variables de entorno (solo nombres)

Declaradas en `.env.example`, `apps/api/src/config/env.validation.ts` y generadas por `03-datos.sh` / `05-app.sh`:

| Grupo | Variables |
|---|---|
| Base y caché | `DATABASE_URL` (dueño del esquema: migraciones, seed, backup), `APP_DATABASE_URL` (rol `kobrax_app`, runtime de la API), `REDIS_URL`, `POSTGRES_PASSWORD`, `KOBRAX_APP_PASSWORD` |
| Autenticación | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` |
| Cifrado de PII | `APP_ENCRYPTION_KEY` (crítica: si se pierde con datos cargados no se recuperan), `APP_BLIND_INDEX_KEY` |
| Red/URLs | `NODE_ENV`, `API_PORT`, `APP_URL`, `SOCKET_CORS_ORIGIN`, `KOBRAX_API_URL` (web → API), `MOBILE_APP_SCHEME` |
| Correo | `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (sin ellos la API solo loguea `[SIN SMTP]`) |
| Push | `FCM_SERVICE_ACCOUNT_JSON_B64` o `FCM_SERVICE_ACCOUNT_FILE` (opcionales) |
| Almacenamiento | `UPLOADS_DIR` (disco), `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (declaradas, sin uso real aún) |
| Rutas | `OSRM_URL` (por defecto `http://localhost:5000`), `OSRM_REGION` (solo compose de desarrollo) |
| Operación | `BACKUP_DIR`, `MIN_APP_VERSION` (corte de versión mínima del móvil) |
| Web (build) | `NEXT_PUBLIC_MAP_STYLE_URL` |
| Móvil (build) | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_MAP_STYLE_URL`, `GOOGLE_SERVICES_JSON`, `KOBRAX_REQUIRE_SSL_PINNING` |
| CI | `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST` |

Archivos con los valores en el servidor: `/opt/kobrax/.env` (secretos crudos) y `/opt/kobrax/app/.env` (derivado por `05-app.sh`). Nunca se versionan.

### 4.4 Respaldos y fotos

- **Respaldos**: `deploy.sh` hace un `pg_dump` comprimido en `/opt/kobrax/backups` antes de cada migración y conserva los últimos 10. Existe además `BackupService` (`apps/api/src/common/backup/`, 14 días de retención, con `run-backup.ts`) pensado para cron. Son **en el mismo disco** que la base: sirven para deshacer una migración, **no** si el servidor se pierde. Subida a Backblaze B2: no hecha. Si hay un cron real corriendo: no verificable desde el repo.
- **Fotos y evidencia**: disco local (`UploadsService`, `UPLOADS_DIR`, por defecto `uploads/<accountId>/<sha256>.jpg`). Las variables S3/R2 están previstas pero el driver **no está escrito** (`uploads.service.ts`: «driver de disco local, nada más»). En `05-app.sh` quedan vacías.

### 4.5 Qué no está resuelto

- Respaldos fuera del servidor (B2) y prueba de restauración.
- Fotos en Cloudflare R2 (hoy mueren con la máquina).
- **OSRM** (ruteo por calles): en `docker-compose.yml` de desarrollo existe, pero `infra/production/` **no lo despliega**; `README.md` lo lista como «no está levantado». Sin él la API usa `http://localhost:5000` y falla el trazado por calles. No verificable desde el repo si se levantó después.
- Un solo servidor; sin balanceador ni segunda réplica (`PRICING-Y-DEPLOY.md` §8 dice que 2 instancias requieren una modificación al programa).
- Correo transaccional profesional (las IPs de Contabo están marcadas por filtros de spam; ver `README.md`).
- La función `app_current_account()` debería crearse en la primera migración (hoy se parcha con `rls-bootstrap.sql`).
- Google Play empresa + D-U-N-S (sin empezar).
- Acceso a Portainer y NPM solo desde una IP fija; cambia si esa IP cambia.
- Cambiar la contraseña por defecto de NPM: el README la marca «CAMBIAR»; no verificable desde el repo.

### 4.6 Qué quedó desactualizado

| Documento | Dice | Realidad en el repo |
|---|---|---|
| `docs/business/PRICING-Y-DEPLOY.md` línea 34 («Deploy / puesta en marcha») | «Hoy Kobrax **todavía no está desplegado**: funciona, pero sólo en la máquina de desarrollo» | Existe `infra/production/` con servidor endurecido, Postgres/Redis en Docker, API y web como servicios, proxy con HTTPS y despliegue automático por GitHub Actions. `PASOS-AHORA.md` afirma que `https://kobrax.ikigaisystems.lat` ya funciona con certificado válido. |
| Mismo doc, sección de costos | Escenario genérico de proveedor | El servidor real es un Contabo VPS (ver `infra/production/README.md`); revisar contra la elección que ese documento recomienda. |
| `infra/production/README.md` («Lo que falta ahora mismo») | DNS pendiente y proxy sin dar de alta | Contradice a `PASOS-AHORA.md`, que dice «ya funciona con certificado válido». Los dos documentos de `infra/production/` no están alineados entre sí. |
| `infra/production/PASOS-AHORA.md` §1 | Base con 0 cuentas/roles; registro falla con `ROLE_CATALOG_MISSING`; «pendiente definir seed completo o solo catálogo» | Se resolvió con `pnpm db:seed:catalog` (commit `96d6eec`). Que el servidor tenga hoy el seed completo o solo el catálogo: **no verificable desde el repo**. |
| `docs/HANDOFF.md` | Describe el entorno de desarrollo (Expo Go, `10.0.2.2`) | No menciona el despliegue ni el dominio. |

---

## 5. App móvil: instalar y probar

Proyecto: `apps/mobile` (Expo SDK 51, React Native 0.74, Expo Router). Versión `1.1.0`, paquete Android e iOS `demo.kobrax.mobile`, esquema `kobrax`.

**Expo Go no es suficiente.** La app usa módulos nativos (`@maplibre/maplibre-react-native` para mapas, pinning SSL, `expo-sqlite`, notificaciones) que Expo Go no incluye; `docs/HANDOFF.md` lo dice explícitamente: el mapa es «dev build» y el pinning «no Expo Go». Con Expo Go corren las pantallas sin mapa nativo.

| Modo | Cómo | Qué pasa |
|---|---|---|
| Expo Go | `pnpm --filter @kobrax/mobile start` y escanear el QR | Solo para pantallas sin módulos nativos; sin mapas ni pinning. Útil para revisión rápida de UI. |
| Build de desarrollo local (Android) | `pnpm --filter @kobrax/mobile android` (`expo run:android`, hace prebuild) | Requiere Android Studio/SDK. Aplica los config plugins: `with-gradle-plugin-dedupe` y `with-ssl-pinning`. |
| iOS | `pnpm --filter @kobrax/mobile ios` (`expo run:ios`) | Requiere macOS/Xcode. |
| APK / EAS | **No hay `eas.json` en el repo.** Un APK se obtendría compilando localmente (`expo prebuild` + Gradle) o creando una configuración EAS que hoy no existe | No hay pipeline de build móvil versionado. |
| Push remoto | Requiere `google-services.json` (ignorado por git) o `GOOGLE_SERVICES_JSON` | Sin él compila y corre, sin push remoto (`app.config.js`). |

**Apuntar a la API**: `EXPO_PUBLIC_API_URL` (por defecto `http://127.0.0.1:4010/api`; el emulador Android usa `http://10.0.2.2:4010/api`; un teléfono físico, la IP de la PC en la LAN). Para usar la demo desplegada, la variable debe contener la URL pública de la API.

**Pinning SSL**: `app.json` fija el dominio `api.kobrax.ikigaisystems.lat` con 3 pins y expiración `2027-09-30`. Un build con esos pins **solo habla con ese host**: un build que apunte a un dominio o IP local debe desactivar el plugin (`enabled: false`) o fallará la conexión. Ver `docs/security/SSL-PINNING-MOVIL.md`. Los pins rotan: caducidad del certificado hoja y rotación documentadas allí.

**Usuarios para probar**: `collector@kobrax.demo` (Carlos), con la ruta de hoy en curso y créditos en mora; también `cobrador1@` a `cobrador4@kobrax.demo`. Contraseña: ver `seed.ts`.

Verificación sin teléfono: `pnpm --filter @kobrax/mobile type-check` y `pnpm --filter @kobrax/mobile test` (jest).

---

## 6. Resumen de lo no verificable desde el repo

- Si el servidor tiene cargado el seed completo, solo el catálogo o ya otro dataset.
- Si `api.kobrax.ikigaisystems.lat` está dada de alta en el proxy y responde.
- Si hay cron de respaldos activo, y la fecha del último respaldo.
- Si OSRM fue levantado después de los documentos de `infra/production/`.
- Si las cuentas `@kobrax.demo` siguen con la contraseña del seed o fue cambiada.
- Si los PDF de `docs/flows/` contienen datos reales.
- Si hay un APK distribuido a testers.
