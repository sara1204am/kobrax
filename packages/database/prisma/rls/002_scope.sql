-- Kobrax · Alcance de datos DENTRO de la empresa (F1 del plan de seguridad)
--
-- `001_enable_rls.sql` aísla una empresa de otra. Este script prepara el segundo nivel:
-- qué filas ve cada persona DENTRO de su empresa. Un cobrador debe ver su cartera asignada,
-- no la de la agencia entera.
--
-- ⚠️ **F1 sólo define los helpers. Las policies llegan en F2.**
-- Es deliberado: `PrismaService.runScoped()` ya setea las tres variables, así que este script
-- se puede aplicar hoy sin cambiar el comportamiento de nada. Cuando F2 agregue los `USING`,
-- la fontanería ya va a estar corriendo y probada en producción.
--
-- Aplicar como el 001, después de él:
--   psql "$DATABASE_URL" -f prisma/rls/002_scope.sql

-- Quién es la persona detrás de la transacción. NULL en trabajos de sistema.
-- Devuelve text por el mismo motivo que `app_current_account()`: Prisma mapea los ids a text.
DROP FUNCTION IF EXISTS app_current_user() CASCADE;
CREATE FUNCTION app_current_user() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '');
$$ LANGUAGE sql STABLE;

/*
 * Con qué alcance corre la transacción. Son EXACTAMENTE tres valores, los fija `PrismaService`:
 *
 *   'account' → toda la cartera del tenant. Admin y supervisión. No depende del canal.
 *   'own'     → sólo la ASIGNACIÓN EFECTIVA de `app_current_user()` (permanente + temporales
 *               vigentes). Hoy: el cobrador, en web y en móvil por igual.
 *   'system'  → trabajos de sistema y flujos pre-sesión. Se pide con `withSystemTenant()`.
 *
 * No hay un cuarto valor. La ausencia de scope se representa con la variable vacía → NULL acá,
 * y NULL nunca es igual a nada: una policy escrita contra esta función **niega por omisión**.
 * Una conexión que no pasó por `withTenant` no debe entregar filas — no debe entregarlas todas.
 * Por eso NO se pone un DEFAULT 'account', por conveniente que parezca al depurar.
 *
 * ⚠️ El canal NO es un scope: no existe 'mobile' ni 'web'. Una asignación temporal TAMPOCO es un
 * scope — es un dato de la asignación efectiva, dentro de 'own'.
 */
DROP FUNCTION IF EXISTS app_current_scope() CASCADE;
CREATE FUNCTION app_current_scope() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.scope', true), '');
$$ LANGUAGE sql STABLE;

/*
 * Atajo para las policies de F2. Encapsula «este alcance ve toda la empresa» en un solo lugar
 * en vez de repetir la comparación en cada tabla — cuando aparezca 'branch' (módulo de
 * sucursales, sin construir), se toca acá y no en veinte policies.
 */
DROP FUNCTION IF EXISTS app_scope_sees_all() CASCADE;
CREATE FUNCTION app_scope_sees_all() RETURNS boolean AS $$
  SELECT app_current_scope() IN ('account', 'system');
$$ LANGUAGE sql STABLE;
