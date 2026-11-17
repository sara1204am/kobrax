-- Legal (documentos, aceptaciones, consentimientos): tablas GLOBALES de solo INSERT.
-- Sin RLS (son por persona, como `users`): el acceso lo controla la aplicación. Lo que aquí SÍ se garantiza en la base es que el rol de
-- la aplicación solo puede LEER e INSERTAR: nunca UPDATE, DELETE ni TRUNCATE (además del trigger `legal_forbid_mutation` de la migración).
-- Idempotente: se puede volver a correr.
REVOKE ALL ON legal_document_versions, user_legal_acceptances, consent_records FROM kobrax_app;
GRANT SELECT, INSERT ON legal_document_versions, user_legal_acceptances, consent_records TO kobrax_app;
