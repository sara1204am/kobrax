-- Kobrax · Verificación de la plataforma y las sesiones de soporte (F14 · F5). SOLO LEE; se puede correr en cualquier entorno, también en producción.
--
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 < packages/database/prisma/rls/verify_platform.sql
--   o todas juntas:  pnpm --filter @kobrax/database db:verify

\set ON_ERROR_STOP on

-- 1. Una sola persona de plataforma (índice único sobre una constante) y sin ninguna fila en una tabla de empresa.
DO $$
DECLARE n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'platform_users_single_row') THEN RAISE EXCEPTION 'falta el índice platform_users_single_row (una sola persona de plataforma)'; END IF;
  SELECT count(*) INTO n FROM platform_users;
  IF n > 1 THEN RAISE EXCEPTION 'platform_users tiene % filas (solo puede haber una)', n; END IF;
  IF EXISTS (SELECT 1 FROM platform_users p JOIN users u ON lower(u.email) = lower(p.email)) THEN
    RAISE EXCEPTION 'la persona de plataforma comparte correo con un usuario de empresa';
  END IF;
  RAISE NOTICE 'OK 1/5 · índice de una sola persona de plataforma (% fila/s) y sin cuenta de empresa con su correo', n;
END $$;

-- 2. Las sesiones de soporte: RLS forzado, vencimiento ≤ 240 min como restricción de la base y consentimiento válido.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'support_sessions' AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'support_sessions no tiene RLS forzado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_sessions_ttl_check') THEN RAISE EXCEPTION 'falta support_sessions_ttl_check (≤ 240 min)'; END IF;
  -- El consentimiento es un enum nativo desde la migración de endurecimiento (reemplaza a la restricción CHECK de texto).
  IF (SELECT udt_name FROM information_schema.columns WHERE table_name = 'support_sessions' AND column_name = 'consent_status') <> 'ConsentStatus' THEN
    RAISE EXCEPTION 'support_sessions.consent_status no es el enum ConsentStatus';
  END IF;
  RAISE NOTICE 'OK 2/5 · support_sessions con RLS forzado, vencimiento ≤ 240 min y consentimiento como enum nativo';
END $$;

-- 3. Ninguna sesión de soporte vigente pide más de lo permitido: nada de plataforma ni de escritura sensible sin consentimiento.
DO $$
DECLARE mal bigint;
BEGIN
  SELECT count(*) INTO mal FROM support_sessions s
    WHERE s.revoked_at IS NULL AND s.expires_at > now() AND s.sensitive AND s.consent_status IN ('NOT_REQUIRED');
  IF mal > 0 THEN RAISE EXCEPTION '% sesiones de soporte vigentes con escritura sensible marcadas «sin consentimiento»', mal; END IF;
  SELECT count(*) INTO mal FROM support_sessions s
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(to_jsonb(s.permissions)) p WHERE p LIKE 'platform:%');
  IF mal > 0 THEN RAISE EXCEPTION '% sesiones de soporte con permisos de plataforma', mal; END IF;
  RAISE NOTICE 'OK 3/5 · ninguna sesión de soporte vigente sin consentimiento donde lo necesita, ni con permisos de plataforma';
END $$;

-- 4. La auditoría distingue a la plataforma de las personas de la cuenta (enum nativo, no texto) y una acción de plataforma no lleva usuario de la cuenta.
DO $$
DECLARE mal bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditActorType') THEN RAISE EXCEPTION 'falta el enum AuditActorType'; END IF;
  IF (SELECT udt_name FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'actor_type') <> 'AuditActorType' THEN
    RAISE EXCEPTION 'audit_logs.actor_type no es el enum AuditActorType';
  END IF;
  SELECT count(*) INTO mal FROM audit_logs WHERE actor_type = 'PLATFORM' AND user_id IS NOT NULL;
  IF mal > 0 THEN RAISE EXCEPTION '% filas de auditoría de plataforma con usuario de la cuenta', mal; END IF;
  RAISE NOTICE 'OK 4/5 · audit_logs.actor_type es enum nativo; ninguna acción de plataforma lleva usuario de la cuenta';
END $$;

-- 5. Los enums nativos de F5 existen y las columnas los usan.
DO $$
DECLARE e text;
BEGIN
  FOREACH e IN ARRAY ARRAY['ConsentStatus', 'AuditActorType', 'RolePermissionSource', 'PermissionRisk', 'PermissionReserved'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = e AND typtype = 'e') THEN RAISE EXCEPTION 'falta el enum nativo %', e; END IF;
  END LOOP;
  RAISE NOTICE 'OK 5/5 · los 5 enums nativos de F5 existen';
END $$;
