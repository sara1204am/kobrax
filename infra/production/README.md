# Producción — estado y manual de operación

Servidor: **144.126.154.33** (Contabo Cloud VPS 8 · 8 núcleos · 24 GB · St. Louis)
Dominio: **ikigaisystems.lat** (registrado en Namecheap, DNS delegado a Vercel)

---

## ⏭️ LO QUE FALTA AHORA MISMO

### 🔴 Tuyo: crear 2 registros DNS **en Vercel**

No en Namecheap. Namecheap sólo vendió el dominio; el DNS lo maneja Vercel
(`ns1.vercel-dns.com` / `ns2.vercel-dns.com`). Registros escritos en Namecheap
no los lee nadie.

1. Entrar a vercel.com con la cuenta desde donde se publicó la landing de COBRA
2. Pestaña **Domains** → clic en `ikigaisystems.lat` (el dominio, no el proyecto)
3. Sección **DNS Records** → agregar estos dos:

| Name | Type | Value | TTL |
|---|---|---|---|
| `kobrax` | `A` | `144.126.154.33` | `60` |
| `api.kobrax` | `A` | `144.126.154.33` | `60` |

**Tres trampas:**
- En **Name** va sólo `kobrax`, NO `kobrax.ikigaisystems.lat`. Vercel agrega el
  dominio solo; si ponés el nombre completo queda duplicado.
- **No tocar** el registro del apex (`@`) ni el de `www`: ahí vive la landing.
- Si dice que ya existe, **editar** en vez de crear otro. Hay un comodín `*` en
  Vercel que atrapa todo, pero un registro explícito le gana.

TTL 60 es a propósito: si algo sale mal se corrige en un minuto, no en una hora.

### 🔴 Tuyo: 2 secretos en GitHub

`Settings → Secrets and variables → Actions → New repository secret`

| Name | Secret |
|---|---|
| `DEPLOY_HOST` | `144.126.154.33` |
| `DEPLOY_KNOWN_HOSTS` | `144.126.154.33 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEIIO/nAfkOBALdvG8WNAdVf1z0efPXOWE7kq+4yq+Sc` |

`DEPLOY_SSH_KEY` ya está cargado. **Cargar estos dos ANTES de pushear**: el
workflow se dispara solo con el primer push a `main` y sin ellos falla.

### 🔴 Tuyo: guardar los secretos de producción

Están en `/opt/kobrax/.env` del servidor. Copiarlos al gestor de contraseñas.
`APP_ENCRYPTION_KEY` es la crítica: cifra los datos sensibles de los clientes y
**si se pierde, no se recuperan ni con los respaldos**. Hoy la base está vacía,
así que perderla no cuesta nada — esa ventana se cierra con el primer cliente.

### Después del DNS (lo hago yo, ~10 min)

1. Dar de alta los 2 Proxy Hosts en NPM y pedir los certificados
2. Cambiar `APP_URL` y `SOCKET_CORS_ORIGIN` al dominio (hoy apuntan a la IP;
   con HTTPS puesto, eso rompe las sesiones)
3. Verificar que `https://kobrax.ikigaisystems.lat` abra el panel

---

## ✅ LO QUE YA FUNCIONA

### Contenedores Docker

| Contenedor | Qué es | Puerto | Quién llega |
|---|---|---|---|
| `kobrax-postgres` | PostgreSQL 15.19 | `127.0.0.1:5434` | 🔒 sólo el servidor |
| `kobrax-redis` | Redis 7 | `127.0.0.1:6379` | 🔒 sólo el servidor |
| `kobrax-npm` | Nginx Proxy Manager | 80, 443, 81 | 80/443 todos · 81 sólo tu IP |
| `portainer` | Consola visual de Docker | 9443 | sólo tu IP |

### La aplicación (NO en Docker)

Corre como servicios de systemd, con el código en `/opt/kobrax/app`:

| Servicio | Puerto | Cerrado a internet |
|---|---|---|
| `kobrax-api` | 4010 | ✅ |
| `kobrax-web` | 3000 | ✅ |

`GET /api/health` responde `{"db":"up","redis":"up"}`.

### Seguridad

- SSH sólo por clave; login por contraseña apagado y verificado
- Firewall: 22, 80, 443 abiertos. 81 y 9443 sólo desde `181.115.172.42`
- Postgres, Redis, 3000 y 4010 **cerrados**, probado desde internet
- `kobrax_app` sin `SUPERUSER` ni `BYPASSRLS` → el aislamiento por RLS aplica
- **32 tablas con RLS forzado · 31 políticas `tenant_isolation`** sobre base real
- Parches de seguridad automáticos

---

## Accesos

| Qué | Dónde | Usuario |
|---|---|---|
| Portainer | https://144.126.154.33:9443 | el que creaste |
| Nginx Proxy Manager | http://144.126.154.33:81 | `admin@example.com` / `changeme` — **CAMBIAR** |
| SSH | `ssh root@144.126.154.33` | por clave |

Ambos paneles sólo aceptan tu IP (`181.115.172.42`). **Si tu IP cambia** perdés
acceso: se repone con `bash /opt/kobrax/04-portainer.sh <IP-nueva>` y
`bash /opt/kobrax/06-proxy.sh <IP-nueva>`.

---

## Los scripts

Se corren en orden sobre una máquina nueva. Todos son idempotentes.

| Script | Qué hace |
|---|---|
| `01-harden.sh` | Apaga la contraseña, firewall, parches automáticos |
| `02-docker.sh` | Docker Engine + compose |
| `03-datos.sh` | Genera secretos (1 sola vez), levanta Postgres y Redis |
| `04-portainer.sh <IP>` | Consola Docker restringida por IP |
| `05-app.sh` | Node 20, pnpm, clon, `.env` de la app, servicios systemd |
| `06-proxy.sh <IP>` | Nginx Proxy Manager |
| `deploy.sh` | **Un despliegue completo.** Lo llama GitHub Actions |

### Qué hace `deploy.sh`, y por qué en ese orden

```
1. git reset --hard origin/main
2. pnpm install --frozen-lockfile
3. prisma generate
4. pnpm build            ← si falla acá, la base NI SE TOCA
5. pg_dump               ← respaldo ANTES de migrar
6. rls-bootstrap.sql     ← la función que las migraciones necesitan
7. prisma migrate deploy
8. los 5 archivos RLS
9. reiniciar api y web   ← si algo falló antes, sigue la versión vieja
10. verificar que arrancaron
11. verificar que el firewall sigue en pie
```

**Nunca** `migrate reset` ni `migrate dev`: el primero borra la base, el segundo
no funciona en este repo.

---

## 🪤 Trampas que costaron tiempo (para no repetirlas)

### `iptables-persistent` desinstala `ufw`

En Ubuntu 24.04 apt lo **quita** para resolver el conflicto, sin fallar y sin
avisar. Las cadenas `ufw-*` quedan colgando vacías, la política vuelve a
`ACCEPT` y **todos los puertos quedan abiertos**. Pasó de verdad el 2026-08-31:
dejó expuestos el 3000 y el 4010. Ahora las reglas persisten con un servicio de
systemd, y `deploy.sh` falla si el firewall no está en pie.

### Docker no respeta `ufw`

Docker escribe sus propias reglas de iptables y se evalúan **antes**. Un
`ufw deny 5434` aparece en `ufw status`, parece aplicado, y el puerto sigue
abierto al mundo. Por eso:
- Postgres y Redis se publican en `127.0.0.1:` explícito
- Portainer se restringe con la cadena `DOCKER-USER`
- El proxy corre en **red de host**, donde `ufw` sí manda

### Las migraciones dependen de una función que vive fuera de `migrations/`

`app_current_account()` se define en `prisma/rls/001_enable_rls.sql`, pero la
migración `20260618160000_add_client_import_runs` la usa. Sobre base vacía no
cierra por ningún lado:

- migrar primero → `function app_current_account() does not exist`
- RLS primero → `relation "branches" does not exist` (el `DO` loop hace
  `ALTER TABLE` sin comprobar que la tabla exista)

Parche: `rls-bootstrap.sql` con la función sola, antes de migrar.

**🔧 ARREGLO DE FONDO PENDIENTE (decisión de la dueña):** esa función debería
crearse en la PRIMERA migración. Ahí desaparece el parche y **`prisma migrate
dev` vuelve a funcionar** — hoy no funciona exactamente por esto.

### `next` no está donde uno espera

Este repo iza las dependencias a la raíz del workspace: `apps/web/node_modules`
sólo tiene `@kobrax`. Apuntarle al `.bin` de la app da `203/EXEC`, que systemd
reporta sin decir qué archivo no encontró.

### El `pg_hba.conf` de la imagen de Postgres es `trust` en 127.0.0.1

Probar una contraseña con `docker exec ... psql -h 127.0.0.1` **entra siempre**,
aunque la contraseña esté mal. Las pruebas de credenciales se hacen desde OTRO
contenedor, donde sí rige `scram-sha-256`.

### `| tail` se traga el código de salida

`bash deploy.sh | tail -60` devuelve el código de `tail`, que es 0 siempre. Un
despliegue fallido reporta éxito. Redirigir a un archivo y leerlo después.

---

## ❌ Lo que NO está hecho

| Qué | Por qué importa |
|---|---|
| **Respaldos fuera del servidor** | El `pg_dump` va al mismo disco que la base. Sirve para deshacer una migración; **no sirve si el servidor se muere**. Falta Backblaze B2 (§9 #6) |
| **Fotos a Cloudflare R2** | Hoy van al disco local y mueren con la máquina. §9 #1 — **las fotos son el producto** |
| **OSRM** | El calculador de rutas no está levantado |
| **Google Play empresa + D-U-N-S** | §9 #15b. **2 a 4 semanas de espera pura.** Sin empezar |
| **Correo profesional** | §9 #7. Nunca mandar correos desde este servidor: las IPs de Contabo están marcadas por los filtros de spam |

Detalle completo en [`docs/business/PRICING-Y-DEPLOY.md`](../../docs/business/PRICING-Y-DEPLOY.md) §9.
