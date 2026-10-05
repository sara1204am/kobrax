# KOBRAX — Agente: Backend API (NestJS)
# Ubicación: apps/api/CLAUDE.md

## Responsabilidad
Este agente gobierna toda la capa de API REST + WebSocket de Kobrax.
Genera, revisa y refactoriza código NestJS siguiendo los patrones definidos aquí.

## Estructura de Módulos NestJS
Organización por dominio, NO por tipo de archivo:
```
src/
├── modules/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/         # JWT, local, refresh
│   │   ├── guards/             # JwtAuthGuard, RolesGuard
│   │   ├── decorators/         # @CurrentUser(), @Roles()
│   │   └── dto/
│   ├── mora/                   # Central de Mora: una fila por crédito, gestiones, promesas, notas
│   │   ├── mora.module.ts
│   │   ├── mora.controller.ts
│   │   ├── mora.service.ts
│   │   └── dto/
│   └── ... (un folder por módulo)
├── common/
│   ├── interceptors/           # AuditInterceptor, TransformInterceptor
│   ├── filters/                # GlobalExceptionFilter
│   ├── guards/                 # TenantGuard
│   ├── decorators/             # @AccountId(), @TenantId()
│   ├── pipes/                  # ValidationPipe config
│   └── middleware/             # TenantMiddleware
├── config/                     # ConfigModule por entorno
├── database/                   # PrismaModule, PrismaService
└── main.ts
```

## Patrones Obligatorios

### Controllers
- Solo reciben request, validan con DTO, delegan al Service
- Nunca lógica de negocio en controllers
- Siempre decorados con `@ApiTags()` y `@ApiBearerAuth()`
- Respuesta envuelta en `ResponseDto<T>`

```typescript
// Patrón estándar de endpoint
@Get(':id')
@Roles(Permission.COLLECTION_READ)
async findOne(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser() user: AuthUser,
): Promise<ResponseDto<MoraCreditDto>> {
  const data = await this.moraService.findOne(id, user.accountId);
  return ResponseDto.ok(data);
}
```

### Services
- Toda la lógica de negocio vive aquí
- Transacciones de DB en operaciones que tocan múltiples tablas
- Emiten eventos de dominio para side-effects (audit, notificaciones)
- Nunca acceden directamente a Prisma — usan el Repository

```typescript
// Patrón de transacción
async assignCredit(dto: AssignCreditDto, accountId: string): Promise<Credit> {
  return this.prisma.$transaction(async (tx) => {
    const credit = await this.creditsRepo.findById(dto.creditId, accountId, tx);
    if (!credit) throw new NotFoundException('Credit not found');
    const updated = await this.creditsRepo.assign(dto, tx);
    this.eventEmitter.emit('payment.registered', new PaymentRegisteredEvent(updated));
    return updated;
  });
}
```

### DTOs
- Siempre con `class-validator` y `class-transformer`
- Swagger decorators obligatorios (`@ApiProperty`)
- Separar DTOs de entrada (Create/Update) de salida (Response)

```typescript
export class CreateCaseDto {
  @ApiProperty({ description: 'ID del crédito en mora' })
  @IsUUID()
  creditId: string;

  @ApiProperty({ enum: CasePriority })
  @IsEnum(CasePriority)
  priority: CasePriority;
}
```

### Multi-tenant (CRÍTICO)
- Middleware extrae `accountId` del JWT y lo inyecta en `request`
- `TenantGuard` verifica que el recurso pertenece al tenant del usuario
- Todo query de Prisma DEBE incluir `where: { accountId }` 
- Si falta el `accountId` en un query → el PR no pasa revisión

```typescript
// Nunca esto:
this.prisma.credit.findMany()

// Siempre esto:
this.prisma.credit.findMany({ where: { accountId } })
```

## Formato de Respuesta API (estándar global)
```typescript
// Éxito
{ data: T, meta: { timestamp, version }, error: null }

// Error
{ data: null, error: { code, message, details? }, meta: { timestamp } }

// Listado paginado
{ data: T[], meta: { total, page, limit, pages }, error: null }
```

## Códigos de Error Internos
```
AUTH_001 → Token inválido o expirado
AUTH_002 → Sin permisos para esta acción
TENANT_001 → Recurso no pertenece al tenant
PAYMENT_001 → Monto no puede ser negativo
EVIDENCE_001 → Hash de evidencia inválido
```

## Seguridad en cada endpoint
```typescript
// Stack de guards obligatorio en endpoints protegidos:
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Permission.COLLECTION_WRITE)
```

## WebSocket Gateway (supervisión en tiempo real)
```typescript
// Rooms por tenant: "tenant:{accountId}"
// Rooms por usuario: "user:{userId}"
// Eventos emitidos:
// - payment.registered → cuando llega un pago
// - collector.location → GPS del cobrador en campo
// - route.completed → ruta finalizada
```

## Variables de entorno que usa la API
```
DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET,
JWT_EXPIRES_IN=15m, JWT_REFRESH_EXPIRES_IN=7d,
S3_BUCKET, SOCKET_CORS_ORIGIN
```
