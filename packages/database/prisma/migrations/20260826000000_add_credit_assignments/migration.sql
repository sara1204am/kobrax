-- Asignación efectiva de créditos: la fuente de verdad del alcance `own` de RLS.
-- Contrato completo en `docs/security/PLAN-SEGURIDAD.md §4.bis`.
--
-- ⚠️ Esta migración NO escribe policies de RLS. Sólo crea la tabla y la puebla desde lo que ya
-- existía. El aislamiento por tenant de esta tabla se activa con `prisma/rls/001_enable_rls.sql`,
-- que hay que volver a correr después de aplicar esta migración (ya la lista).

-- CreateTable
CREATE TABLE "credit_assignments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "case_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "granted_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_assignments_account_id_user_id_revoked_at_idx" ON "credit_assignments"("account_id", "user_id", "revoked_at");
CREATE INDEX "credit_assignments_account_id_credit_id_revoked_at_idx" ON "credit_assignments"("account_id", "credit_id", "revoked_at");
CREATE INDEX "credit_assignments_account_id_case_id_idx" ON "credit_assignments"("account_id", "case_id");

-- AddForeignKey
ALTER TABLE "credit_assignments" ADD CONSTRAINT "credit_assignments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_assignments" ADD CONSTRAINT "credit_assignments_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

/*
 * UNA sola asignación permanente vigente por crédito.
 *
 * «Permanente» no es una columna que pueda contradecirse con las fechas: es la ausencia de las dos
 * formas de vencer (`expires_at` y `case_id`). Al ser un índice parcial, las temporales no compiten
 * entre sí — pueden convivir N vigentes sobre el mismo crédito, que es justo el caso de la
 * cobertura: la permanente de Juan y la temporal de Sara al mismo tiempo.
 */
CREATE UNIQUE INDEX "credit_assignments_one_permanent_per_credit"
    ON "credit_assignments"("account_id", "credit_id")
    WHERE "expires_at" IS NULL AND "case_id" IS NULL AND "revoked_at" IS NULL;

-- Una vigencia que termina antes de empezar no es una asignación, es un error de quien la creó.
ALTER TABLE "credit_assignments" ADD CONSTRAINT "credit_assignments_vigencia_coherente"
    CHECK ("expires_at" IS NULL OR "expires_at" > "starts_at");

/*
 * Backfill: `credits.assigned_manager_id` YA ERA la asignación permanente, sólo que como columna
 * escalar. El trabajo diario de mora lo confirma — al crear una cobranza hace
 * `assignee_id := credit.assigned_manager_id` (`arrears-job.service.ts:230`), o sea que el
 * responsable del crédito es de quien deriva todo lo demás.
 *
 * La columna NO se borra en esta migración. Queda como estaba hasta que el código deje de leerla;
 * borrarla acá dejaría a la web sin el campo «responsable» que ya edita.
 *
 * `starts_at` = la fecha del crédito: la asignación existía desde que el crédito existe, y poner
 * `now()` haría ver todas las asignaciones históricas como creadas el día del despliegue.
 */
INSERT INTO "credit_assignments" ("id", "account_id", "credit_id", "user_id", "starts_at", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "account_id", "id", "assigned_manager_id", "created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "credits"
WHERE "assigned_manager_id" IS NOT NULL AND "deleted_at" IS NULL;
