# KOBRAX — Agente: Testing Strategy
# Ubicación: TESTING_CLAUDE.md (referenciado desde CLAUDE.md raíz)

## Filosofía de Testing
Testing como documentación viva del sistema.
Cada test describe un comportamiento de negocio, no una implementación.

## Pirámide de Tests

```
        /\
       /  \    E2E (5%)
      /----\   → Flows críticos: login, registrar pago, cerrar caso
     /      \
    /--------\  Integration (25%)
   /          \ → API endpoints completos con DB real (test container)
  /------------\
 /              \ Unit (70%)
/________________\ → Services, utilidades, reglas de negocio puras
```

## Stack de Testing

### Backend (NestJS)
```
Jest                    → runner + assertions
@nestjs/testing         → TestingModule
supertest               → HTTP integration tests
testcontainers          → PostgreSQL real en tests de integración
faker-js                → datos de prueba
```

### Frontend (Next.js)
```
Vitest                  → unit tests de hooks y utils
React Testing Library   → component tests
MSW (Mock Service Worker) → mocking de API
Playwright              → E2E flows críticos
```

### Mobile (Expo)
```
Jest + jest-expo        → unit + component tests
React Native Testing Library → component tests
Detox                   → E2E en simulador (solo flows críticos)
```

## Estructura de Tests

```
# Backend
apps/api/src/modules/cases/
├── cases.service.spec.ts        # Unit: lógica de negocio
├── cases.controller.spec.ts     # Unit: guards, DTOs, respuestas
└── cases.integration.spec.ts    # Integration: endpoints completos

# Shared
packages/database/
└── __tests__/
    └── rls.spec.ts              # Verificar aislamiento multi-tenant
```

## Convenciones de Nomenclatura
```typescript
// Patrón: "should [acción] when [condición]"
it('should close case when all activities are resolved')
it('should throw ForbiddenException when user lacks case:write permission')
it('should not return cases from other tenants')
it('should hash evidence file before saving')
```

## Tests Obligatorios por Módulo

### Auth
```typescript
describe('AuthService', () => {
  it('should return tokens when credentials are valid')
  it('should throw UnauthorizedException when password is wrong')
  it('should block login after 5 failed attempts')
  it('should rotate refresh token on each use')
  it('should invalidate refresh token on logout')
})
```

### Multi-tenant (CRÍTICO — nunca omitir)
```typescript
describe('Tenant Isolation', () => {
  it('should not return cases from tenant B when logged in as tenant A')
  it('should reject request if resource accountId differs from JWT accountId')
  it('should apply RLS policy correctly')
})
```

### Cases (Core del Negocio)
```typescript
describe('CasesService', () => {
  it('should create case with PENDING status')
  it('should assign case to collector with lowest load')
  it('should not close case without at least one activity')
  it('should emit CaseAssignedEvent when assignment is made')
  it('should record state change in audit log')
  it('should not allow invalid state transitions')
})
```

### Evidence (Inmutabilidad)
```typescript
describe('FieldEvidenceService', () => {
  it('should calculate SHA-256 hash before saving')
  it('should reject evidence when hash does not match')
  it('should not allow updating or deleting evidence')
  it('should include GPS coordinates in evidence record')
})
```

## Factory de Datos de Test
```typescript
// packages/shared/test-factories/
export const createCase = (overrides?: Partial<CollectionCase>) => ({
  id: faker.string.uuid(),
  accountId: faker.string.uuid(),
  status: CaseStatus.PENDING,
  priority: CasePriority.MEDIUM,
  createdAt: new Date(),
  ...overrides,
});

export const createUser = (overrides?: Partial<User>) => ({ ... });
export const createTenant = (overrides?: Partial<Account>) => ({ ... });
```

## Integration Tests con TestContainer
```typescript
// Levanta PostgreSQL real para cada test suite
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:15')
    .withDatabase('kobrax_test')
    .start();
  // Correr migraciones
  // Correr seeds de test
});

afterAll(async () => {
  await container.stop();
});

// Limpiar entre tests
afterEach(async () => {
  await prisma.$executeRaw`TRUNCATE TABLE collection_cases CASCADE`;
});
```

## E2E Flows Críticos (Playwright)
```
1. Login completo → dashboard carga
2. Cobrador registra visita con foto + GPS
3. Supervisor asigna caso → cobrador lo ve en mobile
4. Registro de pago → caso cambia a PAID
5. Gerente ve KPI actualizado en dashboard
```

## Cobertura Mínima Requerida
```json
// jest.config.ts
coverageThreshold: {
  global: {
    branches: 70,
    functions: 80,
    lines: 80,
    statements: 80,
  },
  // Módulos críticos requieren más
  './src/modules/auth/**': { lines: 90 },
  './src/modules/cases/**': { lines: 85 },
}
```

## CI Pipeline de Tests
```yaml
# Se ejecutan en este orden en cada PR:
1. lint (ESLint + Prettier)
2. type-check (tsc --noEmit)
3. unit tests (jest --testPathPattern=spec)
4. integration tests (jest --testPathPattern=integration)
5. E2E (playwright) ← solo en merge a main
```

## Regla de Oro
Si un bug llega a producción → el primer paso es escribir
un test que lo reproduce ANTES de arreglarlo.
Así el bug no puede volver.
