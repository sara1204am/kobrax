# KOBRAX — Agente: Seguridad & Multi-Tenant
# Ubicación: apps/api/src/modules/auth/CLAUDE.md

## Responsabilidad
Toda la capa de autenticación, autorización y aislamiento de datos de Kobrax.

## Modelo de Autenticación

### JWT (Access + Refresh)
```
Access Token:  15 minutos de vida
Refresh Token: 7 días, rotación en cada uso
Almacenamiento web: httpOnly cookie (NO localStorage)
Almacenamiento mobile: Expo SecureStore (NO AsyncStorage)
```

### Payload del JWT
```typescript
interface JwtPayload {
  sub: string;          // userId
  accountId: string;    // tenant activo
  roleId: string;       // rol en este tenant
  permissions: string[]; // lista plana de permisos activos
  iat: number;
  exp: number;
}
```

### Flujo de autenticación
```
1. POST /auth/login → {email, password}
2. Verificar hash bcrypt (work factor: 12)
3. Generar accessToken + refreshToken
4. Guardar refreshToken hasheado en DB (tabla refresh_tokens)
5. Retornar tokens
6. Refresh: POST /auth/refresh → nuevo par de tokens
7. Logout: invalidar refreshToken en DB
```

## RBAC (Control de Acceso Basado en Roles)

### Roles del sistema (plantillas; F14)
```
SUPER_ADMIN    → plataforma (un único usuario de infraestructura; ninguna ruta lo crea ni edita)
ACCOUNT_ADMIN  → administrador del tenant (todos los permisos)
MANAGER        → gerente regional (alcance de subárbol de su oficina)
SUPERVISOR     → supervisa a su agencia (alcance de agencia)
COLLECTOR      → cobrador en campo (lo suyo)
AUDITOR / VIEWER → sólo lectura
```
El nivel (`Role.level`) y los permisos por rol salen de `ROLE_PERMISSIONS` (`packages/shared/src/constants/permissions.ts`, fuente única, que
el seed vuelca a `role_permissions`). El alcance de datos es un permiso más: `data:scope:all|subtree|branch` (nada → sólo lo propio).

### Permisos granulares (nomenclatura `{recurso}:{acción}`)
Catálogo completo: `Permission` en `@kobrax/shared`. Ejemplos: `collection:read`, `route:execute`, `credit:write`, `user:sessions:revoke`, `data:scope:subtree`.

### Contrato de acceso de cada endpoint (F14 · F3, ADR-F14-03)
**Los guards son GLOBALES** y corren en este orden: `RateLimitGuard`, `AppVersionGuard`, `JwtAuthGuard` (sesión + versiones `av`/`pv`), `TenantGuard`
(tenant presente, sólo para handlers con permisos) y `AuthzGuard` (permisos). **No se pone `@UseGuards` en los controladores.** Cada handler declara
UNO de estos contratos; **sin ninguno se niega: 403 `AUTHZ_000`** (deny by default):

```typescript
@Public()                                   // sin sesión: login, alta de cuenta, salud
@Authenticated()                            // sólo sesión válida: perfil propio, MFA, notificaciones
@Roles(Permission.COLLECTION_READ)          // TODOS los permisos (alias de @Authz({ all }))
@RolesAny(Permission.ROUTE_EXECUTE, Permission.ROUTE_ASSIGN)   // ALGUNO (alias de @Authz({ any }))
@Authz({ all: [...], any: [...] })          // las dos condiciones
@Policy('credit.writeOff')                  // la decisión fina (para quién / sobre qué fila) vive en esa política
@Destructive()                              // acción de riesgo alto (marca; la confirmación llega en F6/F8)
```
Un contrato en la **clase** vale para todos sus handlers; el del handler lo reemplaza. La resolución es única (`authz-access.ts`).

- **Verificación:** `src/modules/authz-coverage.spec.ts` recorre todos los controladores y exige contrato en cada handler; compara la tabla con
  `docs/epics/F14/authz-snapshot.json` (cambiar una puerta = cambiar el snapshot en el mismo commit, y lo aprueba la usuaria).
- **Rollback:** `AUTHZ_DENY_BY_DEFAULT=log` (un release): lo no declarado pasa y se registra en el log.
- **Servicios:** no llaman a `tenant.can(...)`: usan `AuthorizationService` (`common/authz/`): `can/canAny/canAll/assert`, y `assertPolicy` para las
  políticas puras (`policies/`). Las que necesitan datos de la DB van por `PolicyService` + `FactsLoader`. Lista blanca de `tenant.can`: los dos
  resolvedores de alcance (`office-scope.service.ts`, `mora-query.ts`); una prueba lo vigila.
- **Nunca** aceptar `accountId`/`userId` del actor en un DTO (N-13): salen de la sesión (`authz-dto-ids.spec.ts`).

## Multi-Tenant: Aislamiento Total

### Middleware de Tenant
```typescript
// Ejecuta ANTES de cada request
// Extrae accountId del JWT
// Setea contexto PostgreSQL para RLS
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    const accountId = req.user?.accountId;
    if (!accountId) throw new UnauthorizedException();
    // Setear contexto para RLS
    await this.prisma.$executeRaw`
      SET LOCAL app.current_account_id = ${accountId}
    `;
    next();
  }
}
```

### TenantGuard
Guard global: exige `accountId` en la sesión a los handlers con permisos (403 `TENANT_001`). **No valida recursos**: el aislamiento por tenant lo
da `prisma.withTenant(accountId, …)` + RLS, y el alcance por oficina `OfficeScopeService`/`moraAccessConditions`. Nunca confiar sólo en el ID del recurso.

## Cifrado y Hashing

### Contraseñas
```typescript
// bcrypt work factor 12 (no menos)
const hash = await bcrypt.hash(password, 12);
```

### Evidencia Digital (SHA-256)
```typescript
import { createHash } from 'crypto';
const hash = createHash('sha256').update(fileBuffer).digest('hex');
// Guardar hash en field_evidences.file_hash
// Verificar en cada consulta: recalcular hash del archivo y comparar
```

### Datos Sensibles en DB
```
Campos a cifrar a nivel aplicación (AES-256-GCM):
- client.documentNumber (número de documento)
- client.phone
- credit.accountNumber (número de cuenta bancaria si aplica)
Usar CryptoService con IV aleatorio por registro
```

## Rate Limiting
```typescript
// Global: 100 req/min por IP
// Login: 5 intentos fallidos → bloqueo 15 min por email
// API pública: 30 req/min
// Implementar con Redis + @nestjs/throttler
```

## Headers de Seguridad (Helmet)
```typescript
app.use(helmet({
  contentSecurityPolicy: true,
  hsts: { maxAge: 31536000 },
  noSniff: true,
  frameguard: { action: 'deny' },
}));
```

## Auditoría Obligatoria
Toda mutación de datos debe registrar en `audit_logs`:
```typescript
// AuditInterceptor aplica automáticamente a todos los endpoints mutantes
{
  accountId, userId, action, entity, entityId,
  before: { /* estado anterior */ },
  after:  { /* estado nuevo */ },
  ip, userAgent, timestamp
}
// Los logs son APPEND ONLY → nunca se modifican ni eliminan
```

## Checklist de Seguridad por Endpoint
Antes de marcar un endpoint como listo:
- [ ] Contrato de acceso declarado (`@Public` / `@Authenticated` / `@Roles` / `@RolesAny` / `@Authz`); sin él se niega
- [ ] Si hay decisión contextual: `@Policy` + política en `common/authz/policies/`
- [ ] Snapshot de puertas actualizado (`UPDATE_AUTHZ_SNAPSHOT=1 pnpm test`) y aprobado
- [ ] DTO con validación class-validator
- [ ] accountId siempre incluido en queries
- [ ] Audit log registrado en mutaciones
- [ ] Rate limiting considerado
- [ ] Respuesta no expone campos sensibles
