-- F14 · F5 (correcciones del code-review) — endurecimiento del login de plataforma y enums NATIVOS.
--
-- 1. `platform_users`: intentos fallidos y bloqueo temporal, y el último tramo TOTP aceptado (un código ya usado no vuelve a valer).
-- 2. Convención del proyecto (CLAUDE.md raíz: «Enums en DB: PostgreSQL nativo, no strings»): las columnas de estado que F5 creó como TEXT + CHECK pasan a
--    enums nativos. Con un enum, un estado inválido no compila en TypeScript ni entra a la base.
--      support_sessions.consent_status → "ConsentStatus"      audit_logs.actor_type → "AuditActorType"
--      account_role_permissions.source → "RolePermissionSource"
--      permissions.risk → "PermissionRisk"                    permissions.reserved → "PermissionReserved"
--
-- ROLLBACK: volver las columnas a TEXT (`ALTER … TYPE text`) y borrar los tipos; las columnas nuevas de platform_users son aditivas.

ALTER TABLE "platform_users"
  ADD COLUMN "failed_attempts" INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until"    TIMESTAMP(3),
  ADD COLUMN "mfa_last_step"   BIGINT;

-- support_sessions.consent_status
CREATE TYPE "ConsentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'GRANTED', 'DENIED', 'REVOKED');
ALTER TABLE "support_sessions" DROP CONSTRAINT "support_sessions_consent_check";
ALTER TABLE "support_sessions" ALTER COLUMN "consent_status" DROP DEFAULT;
ALTER TABLE "support_sessions" ALTER COLUMN "consent_status" TYPE "ConsentStatus" USING "consent_status"::"ConsentStatus";
ALTER TABLE "support_sessions" ALTER COLUMN "consent_status" SET DEFAULT 'NOT_REQUIRED';

-- audit_logs.actor_type
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'PLATFORM');
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_type_check";
ALTER TABLE "audit_logs" ALTER COLUMN "actor_type" DROP DEFAULT;
ALTER TABLE "audit_logs" ALTER COLUMN "actor_type" TYPE "AuditActorType" USING "actor_type"::"AuditActorType";
ALTER TABLE "audit_logs" ALTER COLUMN "actor_type" SET DEFAULT 'USER';

-- account_role_permissions.source
CREATE TYPE "RolePermissionSource" AS ENUM ('TEMPLATE', 'CUSTOM');
ALTER TABLE "account_role_permissions" DROP CONSTRAINT "account_role_permissions_source_check";
ALTER TABLE "account_role_permissions" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "account_role_permissions" ALTER COLUMN "source" TYPE "RolePermissionSource" USING "source"::"RolePermissionSource";
ALTER TABLE "account_role_permissions" ALTER COLUMN "source" SET DEFAULT 'TEMPLATE';

-- permissions.risk / permissions.reserved
CREATE TYPE "PermissionRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "PermissionReserved" AS ENUM ('PLATFORM', 'ADMIN_CORE');
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_risk_check";
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_reserved_check";
ALTER TABLE "permissions" ALTER COLUMN "risk" DROP DEFAULT;
ALTER TABLE "permissions" ALTER COLUMN "risk" TYPE "PermissionRisk" USING "risk"::"PermissionRisk";
ALTER TABLE "permissions" ALTER COLUMN "risk" SET DEFAULT 'LOW';
ALTER TABLE "permissions" ALTER COLUMN "reserved" TYPE "PermissionReserved" USING "reserved"::"PermissionReserved";
