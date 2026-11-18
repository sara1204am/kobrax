-- Confirmación del correo al crear la cuenta: permisos de `email_verification_tokens`.
--
-- Tabla GLOBAL (como `password_reset_tokens` y `users`): sin cuenta y sin RLS por tenant; la guarda es que solo se guarda la huella (SHA-256) del enlace,
-- que vence a las 48 h y se usa una sola vez. Los permisos van explícitos: las tablas nuevas NO los heredan para `kobrax_app` (solo para
-- `kobrax_scoped`, por `006`). Sin DELETE: los enlaces usados quedan como rastro, no se borran.
--
-- 🔴 Corre ANTES de 006_scope_policies.sql (que copia los permisos de kobrax_app a kobrax_scoped). Idempotente.

GRANT SELECT, INSERT, UPDATE ON email_verification_tokens TO kobrax_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_scoped') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON email_verification_tokens TO kobrax_scoped';
  END IF;
END $$;
