-- F14 · F4 (correcciones del code-review) — dos cosas en una migración aditiva.
--
-- 1. El permiso `client:contact:read` NUNCA llegó a las bases ya desplegadas: sólo estaba en el seed y en el mapa de roles del código, y los
--    permisos del token salen de `role_permissions`. Sin esta fila, todo supervisor, cobrador, gerente y auditor existente perdía contactos,
--    direcciones, adjuntos y el revelado. Lo reciben todos los roles que hoy tienen `client:read` MENOS VIEWER (H-5), y los dos administradores.
-- 2. `files_sync_owner` también limpia `deleted_at` al volver a referenciar un archivo que la limpieza había marcado como borrado.
-- Regla desde f14_03: toda migración que cambie `role_permissions` sube `policy_version`.

INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "active", "updated_at")
VALUES (gen_random_uuid(), 'client:contact:read', 'client:contact:read', 'clients', 'READ', 'ACCOUNT', true, now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'client:contact:read'
WHERE r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'MANAGER', 'SUPERVISOR', 'COLLECTOR', 'AUDITOR')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

UPDATE "platform_settings" SET "policy_version" = "policy_version" + 1, "updated_at" = now() WHERE "id" = 1;

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
        -- También revive un archivo que la limpieza había marcado como borrado (`deleted_at`): si alguien vuelve a referenciar la URL, el registro
        -- tiene que volver a existir para que el dueño apunte a un archivo vivo (el contenido, si ya se borró del disco, devolverá 404).
        UPDATE files SET status = 'ATTACHED', attached_at = COALESCE(attached_at, now()), orphaned_at = NULL, deleted_at = NULL, updated_at = now()
        WHERE id = v_fid AND (status <> 'ATTACHED' OR orphaned_at IS NOT NULL OR deleted_at IS NOT NULL);
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
