-- S-5: a la aplicación sólo se le permite LEER e INSERTAR en las tablas de evidencia (UPDATE/DELETE revocados; el trigger de la
-- migración 20261117000000_evidence_immutability es la segunda barrera). `payments` conserva UPDATE: los triggers de alcance y el
-- vínculo del comprobante lo necesitan; ahí manda el trigger, que limita las columnas.
-- 🔴 Va ANTES de `006_scope_policies.sql` (copia los permisos de kobrax_app a kobrax_scoped al final). Idempotente.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, field_evidences FROM kobrax_app;
REVOKE DELETE, TRUNCATE ON payments FROM kobrax_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_scoped') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, field_evidences FROM kobrax_scoped';
    EXECUTE 'REVOKE DELETE, TRUNCATE ON payments FROM kobrax_scoped';
  END IF;
END $$;
