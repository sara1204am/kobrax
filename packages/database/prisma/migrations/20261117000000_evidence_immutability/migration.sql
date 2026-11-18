-- S-5 · Inmutabilidad real de la evidencia: hasta ahora «inmutable» era una convención de código.
-- Los roles de la aplicación (kobrax_app, kobrax_scoped) ya no pueden modificar ni borrar:
--   · audit_logs y field_evidences  → ninguna mutación.
--   · payments                      → sólo las copias de alcance (credit_branch_id / credit_manager_id, que mantienen los
--                                     triggers de F14·F2b) y el vínculo del comprobante (receipt_url / receipt_hash); nunca DELETE.
-- Los roles de mantenimiento (propietario, migraciones, soporte) quedan fuera a propósito: la barrera es contra la aplicación
-- y contra una cuenta de aplicación comprometida, no contra quien administra la base.

CREATE OR REPLACE FUNCTION evidence_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('kobrax_app', 'kobrax_scoped') THEN
    RAISE EXCEPTION '% es inmutable: % no permitido', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION payments_guard_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable_cols text[] := ARRAY['credit_branch_id', 'credit_manager_id', 'receipt_url', 'receipt_hash'];
BEGIN
  IF current_user NOT IN ('kobrax_app', 'kobrax_scoped') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments es inmutable: DELETE no permitido' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - mutable_cols) IS DISTINCT FROM (to_jsonb(OLD) - mutable_cols) THEN
    RAISE EXCEPTION 'payments es inmutable: sólo se pueden actualizar % ', mutable_cols USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION evidence_forbid_mutation();

DROP TRIGGER IF EXISTS field_evidences_immutable ON field_evidences;
CREATE TRIGGER field_evidences_immutable BEFORE UPDATE OR DELETE ON field_evidences
  FOR EACH ROW EXECUTE FUNCTION evidence_forbid_mutation();

DROP TRIGGER IF EXISTS payments_immutable ON payments;
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard_mutation();
