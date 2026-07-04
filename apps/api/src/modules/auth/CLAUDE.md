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

### Jerarquía de Roles (predefinidos)
```
SUPER_ADMIN    → acceso total al sistema (solo Kobrax)
ACCOUNT_ADMIN  → administrador del tenant
MANAGER        → supervisor de sucursal
SUPERVISOR     → supervisa cobradores
COLLECTOR      → cobrador en campo
AUDITOR        → solo lectura + reportes
```

### Scopes de Permiso
```
global  → sobre todos los tenants (solo SUPER_ADMIN)
account → sobre todo el tenant
branch  → sobre su sucursal
own     → solo sobre sus propios recursos
```

### Permisos Granulares (nomenclatura: {recurso}:{acción})
```
case:read, case:write, case:assign, case:close
payment:read, payment:write, payment:approve
route:read, route:write, route:assign
client:read, client:write
report:read, report:export
user:read, user:write, user:invite
role:read, role:write
audit:read
```

### Implementación en NestJS
```typescript
// Guard de roles
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.get<string[]>(
      'permissions', context.getHandler()
    );
    const user = context.switchToHttp().getRequest().user;
    return requiredPermissions.every(p => user.permissions.includes(p));
  }
}

// Decorador
export const Roles = (...permissions: string[]) =>
  SetMetadata('permissions', permissions);

// Uso en controller
@Get()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('case:read')
async findAll() { ... }
```

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

### TenantGuard (validación de recursos)
```typescript
// Verifica que el recurso pertenece al tenant del usuario
// Nunca confiar solo en el ID del recurso — siempre verificar accountId
async canActivate(context: ExecutionContext): Promise<boolean> {
  const { params, user } = context.switchToHttp().getRequest();
  const resource = await this.service.findOne(params.id);
  return resource?.accountId === user.accountId;
}
```

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
- [ ] JwtAuthGuard aplicado
- [ ] TenantGuard aplicado (si accede a recursos del tenant)
- [ ] RolesGuard con permiso correcto
- [ ] DTO con validación class-validator
- [ ] accountId siempre incluido en queries
- [ ] Audit log registrado en mutaciones
- [ ] Rate limiting considerado
- [ ] Respuesta no expone campos sensibles
