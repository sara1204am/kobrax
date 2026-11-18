-- Privacidad (B6): solicitudes de derechos.
--
-- `privacy_requests` tiene RLS: ve las filas SIN cuenta (las de una persona usuaria sobre sus propios datos, que filtra la aplicación por
-- quien las presentó) y las de la cuenta activa (las que una organización registra por un titular de cobranza). Una cuenta nunca ve las
-- solicitudes de otra, y sin contexto de cuenta solo se ven las personales.
-- Nunca se borran: sin DELETE. `privacy_request_events` es evidencia: solo INSERT (además del trigger de la migración).
--
-- 🔴 Corre ANTES de 006_scope_policies.sql (que debe ser el último: copia los permisos de kobrax_app a kobrax_scoped). Idempotente.
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
-- 🔴 Segunda barrera de los reportes públicos (THIRD_PARTY): son de personas SIN cuenta y no pertenecen a ninguna empresa. Solo se ven y se
-- escriben dentro de una transacción que declaró su superficie (`app.surface` = 'public' en el formulario público, 'platform' en la consola de
-- plataforma; ver `PrismaService.withSurface`). Código de empresa que consulte `privacy_requests` por error NO las ve, aunque se olvide un filtro.
-- Las demás filas siguen como antes: sin cuenta (las personales) o de la cuenta activa.
DROP POLICY IF EXISTS privacy_requests_access ON privacy_requests;
CREATE POLICY privacy_requests_access ON privacy_requests
  USING (
    CASE WHEN subject_kind::text = 'THIRD_PARTY'
         THEN COALESCE(current_setting('app.surface', true), '') IN ('public', 'platform')
         ELSE (account_id IS NULL OR account_id = app_current_account()) END
  )
  WITH CHECK (
    CASE WHEN subject_kind::text = 'THIRD_PARTY'
         THEN COALESCE(current_setting('app.surface', true), '') IN ('public', 'platform')
         ELSE (account_id IS NULL OR account_id = app_current_account()) END
  );

-- Los eventos heredan la visibilidad de su solicitud: la subconsulta pasa por la RLS de `privacy_requests`.
ALTER TABLE privacy_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_request_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_request_events_access ON privacy_request_events;
CREATE POLICY privacy_request_events_access ON privacy_request_events
  USING (EXISTS (SELECT 1 FROM privacy_requests r WHERE r.id = request_id))
  WITH CHECK (EXISTS (SELECT 1 FROM privacy_requests r WHERE r.id = request_id));

REVOKE ALL ON privacy_requests, privacy_request_events FROM kobrax_app;
GRANT SELECT, INSERT, UPDATE ON privacy_requests TO kobrax_app;
GRANT SELECT, INSERT ON privacy_request_events TO kobrax_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_scoped') THEN
    EXECUTE 'REVOKE ALL ON privacy_requests, privacy_request_events FROM kobrax_scoped';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON privacy_requests TO kobrax_scoped';
    EXECUTE 'GRANT SELECT, INSERT ON privacy_request_events TO kobrax_scoped';
  END IF;
END $$;
