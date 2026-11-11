-- F14 · F2b — las copias de oficina / responsable sólo valen para créditos VIVOS (deleted_at IS NULL).
--
-- La primera versión de la barrera (EXISTS sobre `credits … deleted_at IS NULL`) ocultaba los pagos y la agenda de un crédito dado de baja.
-- Con las copias de `20261106000000_f14_f2b_scope_copies` esos pagos seguían visibles (la copia no se limpiaba al dar de baja). Acá se
-- recupera la regla: si el crédito está dado de baja, la copia queda en NULL (y vuelve al restaurarlo), igual que los arreglos de `clients`,
-- que ya sólo cuentan créditos vivos.
--
-- ROLLBACK: aditivo (reemplaza funciones y un trigger). Volver a la definición anterior con la migración previa.

CREATE OR REPLACE FUNCTION scope_copy_credit_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT c.branch_id, c.assigned_manager_id INTO NEW.credit_branch_id, NEW.credit_manager_id
  FROM credits c WHERE c.id = NEW.credit_id AND c.deleted_at IS NULL;
  RETURN NEW; -- sin crédito vivo, SELECT … INTO deja las dos columnas en NULL
END;
$$;

CREATE OR REPLACE FUNCTION credits_push_scope_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch  text := CASE WHEN NEW.deleted_at IS NULL THEN NEW.branch_id END;
  v_manager text := CASE WHEN NEW.deleted_at IS NULL THEN NEW.assigned_manager_id END;
BEGIN
  UPDATE payments SET credit_branch_id = v_branch, credit_manager_id = v_manager
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM v_branch OR credit_manager_id IS DISTINCT FROM v_manager);
  UPDATE agenda_items SET credit_branch_id = v_branch, credit_manager_id = v_manager
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM v_branch OR credit_manager_id IS DISTINCT FROM v_manager);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS credits_scope_push ON credits;
CREATE TRIGGER credits_scope_push AFTER UPDATE OF branch_id, assigned_manager_id, deleted_at ON credits
  FOR EACH ROW WHEN (OLD.branch_id IS DISTINCT FROM NEW.branch_id OR OLD.assigned_manager_id IS DISTINCT FROM NEW.assigned_manager_id
                     OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION credits_push_scope_owner();

-- Backfill: lo que ya existe y pertenece a créditos dados de baja.
UPDATE payments p SET credit_branch_id = NULL, credit_manager_id = NULL
FROM credits c WHERE c.id = p.credit_id AND c.deleted_at IS NOT NULL AND (p.credit_branch_id IS NOT NULL OR p.credit_manager_id IS NOT NULL);
UPDATE agenda_items a SET credit_branch_id = NULL, credit_manager_id = NULL
FROM credits c WHERE c.id = a.credit_id AND c.deleted_at IS NOT NULL AND (a.credit_branch_id IS NOT NULL OR a.credit_manager_id IS NOT NULL);
