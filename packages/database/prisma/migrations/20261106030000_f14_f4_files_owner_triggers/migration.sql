-- F14 · F4 — los dueños de cada archivo se mantienen con TRIGGERS sobre las columnas que guardan la URL.
--
-- POR QUÉ UN TRIGGER Y NO CADA SERVICIO
-- Hay ~10 lugares que guardan la referencia a un archivo (adjuntos, fotos de ubicación / relación / garantía, comprobante, evidencia,
-- foto y QR del perfil, logo, archivo de una importación). Hacer que cada servicio registre al dueño obliga a acordarse en cada uno hoy y
-- en el próximo mañana; el día que uno se olvide, ese archivo deja de poder leerse (o, peor, queda sin dueño). Un trigger agarra TODOS los
-- caminos —la API, una importación, el móvil que sincroniza una cola, un UPDATE a mano—. Mismo criterio que
-- `20260814210000_denormalize_portfolio_totals` y `20261106000000_f14_f2b_scope_copies`.
--
-- QUÉ HACE
--  · al guardar una URL: crea el archivo en `files` si no existía (ATTACHED) o lo pasa a ATTACHED, y registra (archivo, tipo de dueño, id);
--  · al cambiar o quitar una URL: borra el dueño que ya no la referencia, y el archivo que se queda SIN dueños pasa a ORPHAN
--    (la limpieza física, siete días después, la hace un trabajo de fondo);
--  · SECURITY DEFINER (dueño: el rol de migraciones, que ignora RLS): la fila de `files` / `file_owners` se escribe aunque quien dispara el
--    cambio tenga un alcance chico. `rls/verify_scope.sql` comprueba que el dueño de la función ignora RLS.
-- ROLLBACK: DROP TRIGGER … ; DROP FUNCTION files_sync_owner();

CREATE OR REPLACE FUNCTION files_sync_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entity "FileOwnerEntity" := TG_ARGV[0]::"FileOwnerEntity";
  v_col    text := TG_ARGV[1];
  v_kind   text := TG_ARGV[2];            -- 'url' (una URL) | 'urls' (arreglo JSON de URL) | 'key' (la ruta tal cual)
  v_row    jsonb;
  v_val    jsonb;
  v_acc    text;
  v_owner  text;
  v_keys   text[] := '{}';
  v_k      text;
  v_fid    text;
  v_gone   text[] := '{}';
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  v_owner := CASE TG_TABLE_NAME WHEN 'profiles' THEN v_row->>'user_id' ELSE v_row->>'id' END;
  v_acc   := CASE TG_TABLE_NAME WHEN 'accounts' THEN v_row->>'id' WHEN 'profiles' THEN NULL ELSE v_row->>'account_id' END;

  IF TG_OP <> 'DELETE' THEN
    v_val := v_row -> v_col;
    IF v_kind = 'urls' THEN
      IF jsonb_typeof(v_val) = 'array' THEN
        SELECT COALESCE(array_agg(DISTINCT k), '{}') INTO v_keys
        FROM (SELECT substring(u from '[0-9a-f]{64}\.[a-z]{3,4}$') AS k FROM jsonb_array_elements_text(v_val) u) q WHERE k IS NOT NULL;
      END IF;
    ELSIF v_kind = 'url' THEN
      IF jsonb_typeof(v_val) = 'string' THEN
        v_k := substring(v_val #>> '{}' from '[0-9a-f]{64}\.[a-z]{3,4}$');
        IF v_k IS NOT NULL THEN v_keys := ARRAY[v_k]; END IF;
      END IF;
    ELSE
      IF jsonb_typeof(v_val) = 'string' AND length(v_val #>> '{}') > 0 THEN v_keys := ARRAY[v_val #>> '{}']; END IF;
    END IF;
  END IF;

  -- La foto y el QR del perfil son de la PERSONA (la tabla no tiene cuenta): la cuenta es donde subió el archivo; si no, su primera membresía.
  IF v_acc IS NULL AND cardinality(v_keys) > 0 THEN
    SELECT f.account_id INTO v_acc FROM files f WHERE f.uploaded_by = v_owner AND f.storage_key = ANY (v_keys) LIMIT 1;
    IF v_acc IS NULL THEN
      SELECT ua.account_id INTO v_acc FROM user_accounts ua WHERE ua.user_id = v_owner ORDER BY ua.created_at LIMIT 1;
    END IF;
  END IF;

  IF v_acc IS NOT NULL THEN
    FOREACH v_k IN ARRAY v_keys LOOP
      SELECT id INTO v_fid FROM files WHERE account_id = v_acc AND storage_key = v_k;
      IF v_fid IS NULL THEN
        INSERT INTO files (id, account_id, storage_key, sha256, mime, status, attached_at, created_at, updated_at)
        VALUES (gen_random_uuid()::text, v_acc, v_k, COALESCE(substring(v_k from '[0-9a-f]{64}'), v_k),
                CASE lower(right(v_k, 3)) WHEN 'jpg' THEN 'image/jpeg' WHEN 'png' THEN 'image/png' WHEN 'ebp' THEN 'image/webp' WHEN 'pdf' THEN 'application/pdf' ELSE 'application/octet-stream' END,
                'ATTACHED', now(), now(), now())
        ON CONFLICT (account_id, storage_key) DO NOTHING;
        SELECT id INTO v_fid FROM files WHERE account_id = v_acc AND storage_key = v_k;
      ELSE
        UPDATE files SET status = 'ATTACHED', attached_at = COALESCE(attached_at, now()), orphaned_at = NULL, updated_at = now()
        WHERE id = v_fid AND (status <> 'ATTACHED' OR orphaned_at IS NOT NULL);
      END IF;
      INSERT INTO file_owners (id, account_id, file_id, owner_entity, owner_id)
      VALUES (gen_random_uuid()::text, v_acc, v_fid, v_entity, v_owner)
      ON CONFLICT (file_id, owner_entity, owner_id) DO NOTHING;
    END LOOP;
  END IF;

  -- Los dueños que ya no referencian al archivo (la URL cambió o se quitó, o la fila se borró).
  WITH gone AS (
    DELETE FROM file_owners o USING files f
    WHERE f.id = o.file_id AND o.owner_entity = v_entity AND o.owner_id = v_owner AND NOT (f.storage_key = ANY (v_keys))
    RETURNING o.file_id)
  SELECT COALESCE(array_agg(file_id), '{}') INTO v_gone FROM gone;
  IF cardinality(v_gone) > 0 THEN
    UPDATE files f SET status = 'ORPHAN', orphaned_at = now(), updated_at = now()
    WHERE f.id = ANY (v_gone) AND f.status = 'ATTACHED' AND NOT EXISTS (SELECT 1 FROM file_owners o2 WHERE o2.file_id = f.id);
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$$;

CREATE TRIGGER client_attachments_files_sync AFTER INSERT OR DELETE OR UPDATE OF file_url ON client_attachments
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('CLIENT_ATTACHMENT', 'file_url', 'url');
CREATE TRIGGER client_locations_files_sync AFTER INSERT OR DELETE OR UPDATE OF photo_urls ON client_locations
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('CLIENT_LOCATION', 'photo_urls', 'urls');
CREATE TRIGGER client_relations_files_sync AFTER INSERT OR DELETE OR UPDATE OF photo_urls ON client_relations
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('CLIENT_RELATION', 'photo_urls', 'urls');
CREATE TRIGGER collaterals_files_sync AFTER INSERT OR DELETE OR UPDATE OF photo_urls ON collaterals
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('COLLATERAL', 'photo_urls', 'urls');
CREATE TRIGGER payments_files_sync AFTER INSERT OR DELETE OR UPDATE OF receipt_url ON payments
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('PAYMENT_RECEIPT', 'receipt_url', 'url');
CREATE TRIGGER field_evidences_files_sync AFTER INSERT OR DELETE OR UPDATE OF file_url ON field_evidences
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('FIELD_EVIDENCE', 'file_url', 'url');
CREATE TRIGGER accounts_files_sync AFTER INSERT OR DELETE OR UPDATE OF logo_url ON accounts
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('ACCOUNT_LOGO', 'logo_url', 'url');
CREATE TRIGGER profiles_photo_files_sync AFTER INSERT OR DELETE OR UPDATE OF photo_url ON profiles
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('PROFILE_PHOTO', 'photo_url', 'url');
CREATE TRIGGER profiles_qr_files_sync AFTER INSERT OR DELETE OR UPDATE OF payment_qr_url ON profiles
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('PROFILE_QR', 'payment_qr_url', 'url');
CREATE TRIGGER client_import_runs_files_sync AFTER INSERT OR DELETE OR UPDATE OF file_key ON client_import_runs
  FOR EACH ROW EXECUTE FUNCTION files_sync_owner('IMPORT_RUN', 'file_key', 'key');
