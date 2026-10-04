# Estado y qué falta

**https://kobrax.ikigaisystems.lat** ← ya funciona, con certificado válido.

---

## ✅ Terminado

- Servidor endurecido: SSH sólo por clave, firewall, parches automáticos
- PostgreSQL + Redis, cerrados a internet
- API y panel web corriendo como servicios
- Portainer y Nginx Proxy Manager, sólo desde tu IP
- HTTPS con Let's Encrypt, renovación automática
- Despliegue automático escrito y probado de punta a punta
- 32 tablas con RLS forzado · 31 políticas de aislamiento por empresa

---

## ❌ Falta — en orden de importancia

### 1. No se puede entrar todavía 🔴

La base tiene las tablas pero **0 cuentas, 0 usuarios, 0 roles**.

El registro falla con `ROLE_CATALOG_MISSING` ("Catálogo de roles no
inicializado") porque exige que el catálogo de roles exista primero.

Hay que cargar **sólo** el catálogo de roles y permisos, sin los datos de
demostración que trae el seed completo (clientes, créditos, rutas de prueba).

*Pendiente de definir con vos: si preferís el seed completo para probar, o sólo
el catálogo para arrancar limpio con datos reales.*

### 2. Tuyo: pushear y activar el CI 🔴

- Cargar en GitHub: `DEPLOY_HOST` = `144.126.154.33`
- Cargar en GitHub: `DEPLOY_KNOWN_HOSTS` =
  `144.126.154.33 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEIIO/nAfkOBALdvG8WNAdVf1z0efPXOWE7kq+4yq+Sc`
- Pushear los commits de `infra/production/`

Con eso, cada merge a `main` despliega solo.

### 3. Tuyo: guardar los secretos 🔴

Están en `/opt/kobrax/.env`. Copiarlos al gestor de contraseñas.
`APP_ENCRYPTION_KEY` es la crítica: si se pierde con datos cargados, esos datos
no se recuperan ni con los respaldos.

### 4. Respaldos fuera del servidor

Hoy el `pg_dump` queda en el mismo disco que la base. Sirve para deshacer una
migración; **no sirve si el servidor se muere**. Falta Backblaze B2.

### 5. Fotos a Cloudflare R2

Hoy van al disco local y mueren con la máquina. **Las fotos son el producto.**

### 6. OSRM

El calculador de rutas no está levantado.

### 7. Google Play empresa + D-U-N-S ⏰

Sin empezar. **2 a 4 semanas de espera pura**, no es trabajo.
