-- Extensiones de PostgreSQL para Kobrax.
-- pg_stat_statements: monitoreo de rendimiento de queries (requiere
-- shared_preload_libraries=pg_stat_statements, configurado en docker-compose).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
