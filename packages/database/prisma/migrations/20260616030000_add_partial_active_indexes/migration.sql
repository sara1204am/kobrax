-- Índices parciales del hot-path: cubren solo filas vivas (deleted_at IS NULL),
-- que es el filtro por defecto de todos los repositorios. Más selectivos y
-- pequeños que los índices completos generados por Prisma.
--
-- Nota: usamos índices compuestos (account_id, ...) WHERE deleted_at IS NULL en
-- lugar del índice literal sobre (deleted_at) del template del agente, porque el
-- patrón de query real es "registros vivos de mi tenant", no "buscar borrados".

-- Tablas operativas con account_id + soft delete
CREATE INDEX IF NOT EXISTS idx_branches_account_active
  ON branches (account_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_account_active
  ON clients (account_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_credits_account_active
  ON credits (account_id) WHERE deleted_at IS NULL;

-- Casos: hot-path de listados de cartera (por estado y por gestor asignado)
CREATE INDEX IF NOT EXISTS idx_cases_account_active
  ON collection_cases (account_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cases_status_active
  ON collection_cases (account_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cases_assignee_active
  ON collection_cases (account_id, assignee_id) WHERE deleted_at IS NULL;

-- Usuarios (tabla global): filtrar activos por estado (columna user_status)
CREATE INDEX IF NOT EXISTS idx_users_status_active
  ON users (user_status) WHERE deleted_at IS NULL;
