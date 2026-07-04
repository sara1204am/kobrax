-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('FINANCIAL_INSTITUTION', 'COLLECTION_AGENCY', 'RETAIL_CREDIT', 'INDEPENDENT');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'TRIAL', 'SUSPENDED', 'INACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED', 'PENDING');

-- CreateEnum
CREATE TYPE "PermissionAction" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'EXECUTE', 'APPROVE');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('GLOBAL', 'ACCOUNT', 'BRANCH', 'OWN');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('HOME', 'WORK', 'GUARANTOR', 'FAMILY', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('GUARANTOR', 'FAMILY', 'COWORKER', 'NEIGHBOR', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('ID_CARD', 'PHOTO', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('ACTIVE', 'PAID', 'DEFAULTED', 'RESTRUCTURED', 'WRITTEN_OFF', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('PENDING', 'ACTIVE', 'IN_NEGOTIATION', 'PROMISE_TO_PAY', 'PAID', 'CLOSED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CaseActivityType" AS ENUM ('NOTE', 'CALL', 'VISIT', 'PAYMENT', 'STATUS_CHANGE', 'ASSIGNMENT', 'MESSAGE');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RouteStopStatus" AS ENUM ('PENDING', 'IN_ROUTE', 'VISITED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('PHOTO', 'SIGNATURE', 'DOCUMENT', 'AUDIO');

-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('NO_CONTACT', 'CONTACTED', 'PROMISE_TO_PAY', 'PARTIAL_PAYMENT', 'PAID', 'REFUSAL', 'NOT_FOUND', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'QR', 'CARD', 'MOBILE_PAYMENT');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CASE_ASSIGNED', 'CASE_UPDATED', 'PAYMENT_REGISTERED', 'ROUTE_ASSIGNED', 'PROMISE_DUE', 'SYSTEM');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "business_name" TEXT NOT NULL,
    "tax_id" TEXT,
    "account_type" "AccountType" NOT NULL,
    "account_status" "AccountStatus" NOT NULL DEFAULT 'TRIAL',
    "plan_code" "PlanCode" NOT NULL DEFAULT 'STARTER',
    "max_users" INTEGER NOT NULL DEFAULT 5,
    "country_code" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "timezone" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "city" TEXT,
    "address" TEXT,
    "manager_user_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "salt" TEXT,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "requires_password_change" BOOLEAN NOT NULL DEFAULT true,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" TEXT,
    "user_status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "last_login_at" TIMESTAMP(3),
    "last_known_lat" DECIMAL(10,8),
    "last_known_lng" DECIMAL(11,8),
    "last_location_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "document_number" TEXT,
    "photo_url" TEXT,
    "language" TEXT NOT NULL DEFAULT 'es',
    "employee_code" TEXT,
    "supervisor_user_id" TEXT,
    "hire_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "resource" TEXT,
    "scope" "PermissionScope" NOT NULL DEFAULT 'GLOBAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "granted_by" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "permission_id" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "granted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "device_info" TEXT,
    "login_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logout_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "business_name" TEXT,
    "gender" TEXT,
    "national_id" TEXT,
    "tax_id" TEXT,
    "client_type" "ClientType" NOT NULL DEFAULT 'PERSON',
    "client_status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "preferred_contact_channel" TEXT,
    "risk_segment" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "contact_type" "ContactType" NOT NULL,
    "value" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_locations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "location_type" "LocationType" NOT NULL DEFAULT 'HOME',
    "address" TEXT,
    "zone" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "reference_notes" TEXT,
    "photo_urls" JSONB NOT NULL DEFAULT '[]',
    "visit_schedule" JSONB,
    "risk_level" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_relations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "related_name" TEXT NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,
    "gender" TEXT,
    "phone" TEXT,
    "location_id" TEXT,
    "photo_urls" JSONB NOT NULL DEFAULT '[]',
    "is_contactable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_attachments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "file_type" "AttachmentType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_hash" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credits" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT,
    "principal_amount" DECIMAL(14,2) NOT NULL,
    "outstanding_balance" DECIMAL(14,2) NOT NULL,
    "interest_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "installments_count" INTEGER NOT NULL DEFAULT 1,
    "status" "CreditStatus" NOT NULL DEFAULT 'ACTIVE',
    "days_past_due" INTEGER NOT NULL DEFAULT 0,
    "assigned_manager_id" TEXT,
    "disbursed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_installments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arrears" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "days_overdue" INTEGER NOT NULL DEFAULT 0,
    "overdue_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arrears_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_cases" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "assignee_id" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "CasePriority" NOT NULL DEFAULT 'MEDIUM',
    "sla_due_at" TIMESTAMP(3),
    "last_action_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "closed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "collection_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_activities" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "CaseActivityType" NOT NULL,
    "result" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_plans" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "collector_id" TEXT NOT NULL,
    "planned_date" DATE NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'PLANNED',
    "total_cases" INTEGER NOT NULL DEFAULT 0,
    "total_distance_km" DECIMAL(8,2),
    "estimated_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "case_id" TEXT,
    "sequence_order" INTEGER NOT NULL,
    "status" "RouteStopStatus" NOT NULL DEFAULT 'PENDING',
    "predicted_recovery_score" DECIMAL(5,4),
    "visited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_visits" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "case_id" TEXT,
    "route_stop_id" TEXT,
    "collector_id" TEXT NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "accuracy" DECIMAL(7,2),
    "outcome" "VisitOutcome" NOT NULL,
    "notes" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_evidences" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "captured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_evidences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "case_id" TEXT,
    "installment_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" TEXT,
    "external_transaction_id" TEXT,
    "receipt_number" INTEGER,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT,
    "client_id" TEXT,
    "case_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'QR',
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "qr_payload" TEXT,
    "url" TEXT,
    "expires_at" TIMESTAMP(3),
    "paid_payment_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "client_id" TEXT,
    "credit_id" TEXT,
    "case_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE INDEX "accounts_account_status_idx" ON "accounts"("account_status");

-- CreateIndex
CREATE INDEX "accounts_deleted_at_idx" ON "accounts"("deleted_at");

-- CreateIndex
CREATE INDEX "branches_account_id_idx" ON "branches"("account_id");

-- CreateIndex
CREATE INDEX "branches_account_id_active_idx" ON "branches"("account_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_user_status_idx" ON "users"("user_status");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_permission_overrides_user_id_idx" ON "user_permission_overrides"("user_id");

-- CreateIndex
CREATE INDEX "user_accounts_account_id_idx" ON "user_accounts"("account_id");

-- CreateIndex
CREATE INDEX "user_accounts_account_id_role_id_idx" ON "user_accounts"("account_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_user_id_account_id_key" ON "user_accounts"("user_id", "account_id");

-- CreateIndex
CREATE INDEX "user_sessions_account_id_user_id_idx" ON "user_sessions"("account_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_logs_account_id_entity_entity_id_idx" ON "audit_logs"("account_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_account_id_user_id_idx" ON "audit_logs"("account_id", "user_id");

-- CreateIndex
CREATE INDEX "clients_account_id_idx" ON "clients"("account_id");

-- CreateIndex
CREATE INDEX "clients_account_id_client_status_idx" ON "clients"("account_id", "client_status");

-- CreateIndex
CREATE INDEX "clients_account_id_national_id_idx" ON "clients"("account_id", "national_id");

-- CreateIndex
CREATE INDEX "clients_deleted_at_idx" ON "clients"("deleted_at");

-- CreateIndex
CREATE INDEX "client_contacts_account_id_client_id_idx" ON "client_contacts"("account_id", "client_id");

-- CreateIndex
CREATE INDEX "client_locations_account_id_client_id_idx" ON "client_locations"("account_id", "client_id");

-- CreateIndex
CREATE INDEX "client_relations_account_id_client_id_idx" ON "client_relations"("account_id", "client_id");

-- CreateIndex
CREATE INDEX "client_attachments_account_id_client_id_idx" ON "client_attachments"("account_id", "client_id");

-- CreateIndex
CREATE INDEX "credits_account_id_idx" ON "credits"("account_id");

-- CreateIndex
CREATE INDEX "credits_account_id_status_idx" ON "credits"("account_id", "status");

-- CreateIndex
CREATE INDEX "credits_account_id_client_id_idx" ON "credits"("account_id", "client_id");

-- CreateIndex
CREATE INDEX "credits_deleted_at_idx" ON "credits"("deleted_at");

-- CreateIndex
CREATE INDEX "credit_installments_account_id_credit_id_idx" ON "credit_installments"("account_id", "credit_id");

-- CreateIndex
CREATE INDEX "credit_installments_account_id_status_idx" ON "credit_installments"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_installments_credit_id_number_key" ON "credit_installments"("credit_id", "number");

-- CreateIndex
CREATE INDEX "arrears_account_id_credit_id_idx" ON "arrears"("account_id", "credit_id");

-- CreateIndex
CREATE INDEX "collection_cases_account_id_status_idx" ON "collection_cases"("account_id", "status");

-- CreateIndex
CREATE INDEX "collection_cases_account_id_assignee_id_idx" ON "collection_cases"("account_id", "assignee_id");

-- CreateIndex
CREATE INDEX "collection_cases_account_id_client_id_idx" ON "collection_cases"("account_id", "client_id");

-- CreateIndex
CREATE INDEX "collection_cases_deleted_at_idx" ON "collection_cases"("deleted_at");

-- CreateIndex
CREATE INDEX "case_activities_account_id_case_id_idx" ON "case_activities"("account_id", "case_id");

-- CreateIndex
CREATE INDEX "route_plans_account_id_status_idx" ON "route_plans"("account_id", "status");

-- CreateIndex
CREATE INDEX "route_plans_account_id_collector_id_planned_date_idx" ON "route_plans"("account_id", "collector_id", "planned_date");

-- CreateIndex
CREATE INDEX "route_stops_account_id_route_id_idx" ON "route_stops"("account_id", "route_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_sequence_order_key" ON "route_stops"("route_id", "sequence_order");

-- CreateIndex
CREATE INDEX "field_visits_account_id_case_id_idx" ON "field_visits"("account_id", "case_id");

-- CreateIndex
CREATE INDEX "field_visits_account_id_collector_id_idx" ON "field_visits"("account_id", "collector_id");

-- CreateIndex
CREATE INDEX "field_evidences_account_id_visit_id_idx" ON "field_evidences"("account_id", "visit_id");

-- CreateIndex
CREATE INDEX "payments_account_id_credit_id_idx" ON "payments"("account_id", "credit_id");

-- CreateIndex
CREATE INDEX "payments_account_id_payment_date_idx" ON "payments"("account_id", "payment_date");

-- CreateIndex
CREATE UNIQUE INDEX "payments_account_id_receipt_number_key" ON "payments"("account_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_account_id_external_transaction_id_key" ON "payments"("account_id", "external_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_reference_key" ON "payment_requests"("reference");

-- CreateIndex
CREATE INDEX "payment_requests_account_id_status_idx" ON "payment_requests"("account_id", "status");

-- CreateIndex
CREATE INDEX "notifications_account_id_user_id_idx" ON "notifications"("account_id", "user_id");

-- CreateIndex
CREATE INDEX "notifications_account_id_user_id_read_at_idx" ON "notifications"("account_id", "user_id", "read_at");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_relations" ADD CONSTRAINT "client_relations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_relations" ADD CONSTRAINT "client_relations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "client_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_attachments" ADD CONSTRAINT "client_attachments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_installments" ADD CONSTRAINT "credit_installments_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrears" ADD CONSTRAINT "arrears_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_activities" ADD CONSTRAINT "case_activities_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "collection_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "route_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "collection_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "collection_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_route_stop_id_fkey" FOREIGN KEY ("route_stop_id") REFERENCES "route_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_evidences" ADD CONSTRAINT "field_evidences_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "field_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "collection_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
