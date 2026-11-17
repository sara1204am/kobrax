-- Legal (documentos, aceptaciones, consentimientos): tablas GLOBALES de solo INSERT.
-- Sin RLS (son por persona, como `users`): el acceso lo controla la aplicación. Lo que aquí SÍ se garantiza en la base es que los roles de
-- la aplicación solo pueden LEER e INSERTAR: nunca UPDATE, DELETE ni TRUNCATE (además del trigger `legal_forbid_mutation` de la migración).
--
-- 🔴 El nombre `005b` es a propósito: `db:rls` corre los scripts por orden alfabético y `006_scope_policies.sql` **tiene que ser el último**,
-- porque al final copia los permisos de `kobrax_app` al rol `kobrax_scoped` (y la API comprueba al arrancar que no falte ninguno). Un script
-- que corra después de 006 deja a `kobrax_scoped` sin permisos y la API con la barrera de alcance no arranca.
--
-- `kobrax_scoped` también se revoca aquí: las tablas nuevas le llegan por privilegios por omisión con UPDATE y DELETE, que para
-- evidencia no deben existir. Si el rol todavía no existe (base nueva), lo crea 006 y copia los permisos ya correctos de `kobrax_app`.
-- Idempotente: se puede volver a correr.
REVOKE ALL ON legal_document_versions, user_legal_acceptances, consent_records FROM kobrax_app;
GRANT SELECT, INSERT ON legal_document_versions, user_legal_acceptances, consent_records TO kobrax_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_scoped') THEN
    EXECUTE 'REVOKE ALL ON legal_document_versions, user_legal_acceptances, consent_records FROM kobrax_scoped';
    EXECUTE 'GRANT SELECT, INSERT ON legal_document_versions, user_legal_acceptances, consent_records TO kobrax_scoped';
  END IF;
END $$;
