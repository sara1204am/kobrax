# KOBRAX — Agente: Base de Datos
# Ubicación: packages/database/CLAUDE.md

## Responsabilidad
Gobierna el schema de Prisma, migraciones, seeds y políticas RLS de PostgreSQL.

## Reglas del Schema Prisma (NO NEGOCIABLES)

### Campos obligatorios en TODA tabla
```prisma
id         String   @id @default(uuid())
createdAt  DateTime @default(now()) @map("created_at")
updatedAt  DateTime @updatedAt @map("updated_at")
deletedAt  DateTime? @map("deleted_at")   // soft delete siempre
```

### Multi-tenant obligatorio en tablas operativas
```prisma
accountId  String   @map("account_id")
account    Account  @relation(fields: [accountId], references: [id])
```
Tablas SIN account_id (solo globales): `Account`, `Plan`, `Country`

### Convenciones
- Nombres de modelos: `PascalCase` singular (`CollectionCase`, no `Cases`)
- Nombres de campos DB: `snake_case` via `@map()`
- Nombres de tablas: `snake_case` plural via `@@map()`
- Enums: PostgreSQL nativo con `@db.Enum`
- Índices: obligatorios en `accountId`, `deletedAt`, campos de búsqueda frecuente

## Schema Core (entidades principales)

```prisma
// Tenant raíz
model Account {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique
  planId      String   @map("plan_id")
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  deletedAt   DateTime? @map("deleted_at")
  @@map("accounts")
}

// Usuario global (puede pertenecer a múltiples tenants)
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  deletedAt    DateTime? @map("deleted_at")
  accounts     UserAccount[]
  @@map("users")
}

// Relación User ↔ Account con rol
model UserAccount {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  accountId String   @map("account_id")
  roleId    String   @map("role_id")
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  user      User     @relation(fields: [userId], references: [id])
  account   Account  @relation(fields: [accountId], references: [id])
  role      Role     @relation(fields: [roleId], references: [id])
  @@unique([userId, accountId])
  @@map("user_accounts")
}

// Caso de cobranza
model CollectionCase {
  id          String          @id @default(uuid())
  accountId   String          @map("account_id")
  creditId    String          @map("credit_id")
  assigneeId  String?         @map("assignee_id")
  status      CaseStatus      @default(PENDING)
  priority    CasePriority    @default(MEDIUM)
  closedAt    DateTime?       @map("closed_at")
  closedBy    String?         @map("closed_by")
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")
  deletedAt   DateTime?       @map("deleted_at")
  activities  CaseActivity[]
  @@index([accountId, status])
  @@index([accountId, assigneeId])
  @@map("collection_cases")
}

enum CaseStatus {
  PENDING
  ACTIVE
  IN_NEGOTIATION
  PROMISE_TO_PAY
  PAID
  CLOSED
  WRITTEN_OFF
}

enum CasePriority {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

// Evidencia digital (inmutable)
model FieldEvidence {
  id           String      @id @default(uuid())
  accountId    String      @map("account_id")
  activityId   String      @map("activity_id")
  type         EvidenceType
  fileUrl      String      @map("file_url")
  fileHash     String      @map("file_hash")  // SHA-256, inmutable
  latitude     Decimal?    @db.Decimal(10, 8)
  longitude    Decimal?    @db.Decimal(11, 8)
  capturedAt   DateTime    @map("captured_at")
  createdAt    DateTime    @default(now()) @map("created_at")
  // SIN updatedAt ni deletedAt → INMUTABLE por diseño
  @@map("field_evidences")
}

enum EvidenceType {
  PHOTO
  SIGNATURE
  DOCUMENT
  AUDIO
}

// Audit log (append-only, nunca se modifica)
model AuditLog {
  id         String   @id @default(uuid())
  accountId  String   @map("account_id")
  userId     String   @map("user_id")
  action     String
  entity     String
  entityId   String   @map("entity_id")
  before     Json?
  after      Json?
  ip         String?
  userAgent  String?  @map("user_agent")
  createdAt  DateTime @default(now()) @map("created_at")
  // Sin updatedAt ni deletedAt → APPEND ONLY
  @@index([accountId, entity, entityId])
  @@index([accountId, userId])
  @@map("audit_logs")
}
```

## Reglas de Migraciones
- Nombre descriptivo: `add_collection_cases_table`, no `migration_001`
- Nunca modificar una migración ya ejecutada en producción
- Toda migration incluye su política RLS correspondiente (ver abajo)
- Seeds en `packages/database/seeds/` separados por entorno

## Row Level Security (RLS) — Template
Ejecutar después de cada migration que agrega tabla operativa:

```sql
-- Activar RLS
ALTER TABLE collection_cases ENABLE ROW LEVEL SECURITY;

-- Policy para acceso del tenant
CREATE POLICY tenant_isolation ON collection_cases
  USING (account_id = current_setting('app.current_account_id')::uuid);

-- Dar permiso al rol de app (no al superuser)
GRANT SELECT, INSERT, UPDATE ON collection_cases TO kobrax_app;
```

La API setea el contexto antes de cada query:
```sql
SET LOCAL app.current_account_id = '<uuid>';
```

## Índices de Performance (obligatorios)
```sql
-- En toda tabla operativa
CREATE INDEX idx_{table}_account_id ON {table}(account_id);
CREATE INDEX idx_{table}_deleted_at ON {table}(deleted_at) WHERE deleted_at IS NULL;

-- En collection_cases
CREATE INDEX idx_cases_status ON collection_cases(account_id, status);
CREATE INDEX idx_cases_assignee ON collection_cases(account_id, assignee_id);
```

## Vistas Materializadas (Analytics)
```sql
-- Refrescar cada hora via cron
CREATE MATERIALIZED VIEW mv_daily_recovery AS
SELECT
  account_id,
  DATE(created_at) as date,
  COUNT(*) FILTER (WHERE status = 'PAID') as paid_count,
  SUM(amount) FILTER (WHERE status = 'PAID') as recovered_amount
FROM collection_cases
GROUP BY account_id, DATE(created_at);

CREATE UNIQUE INDEX ON mv_daily_recovery(account_id, date);
```
