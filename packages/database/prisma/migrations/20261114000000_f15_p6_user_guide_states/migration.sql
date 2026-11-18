-- F15 · P6 (D-13, D-17): estado de las guías por persona y organización. Aditiva y reversible: DROP TABLE "user_guide_states".
CREATE TABLE "user_guide_states" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_guide_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_guide_states_account_id_user_id_key" ON "user_guide_states"("account_id", "user_id");

ALTER TABLE "user_guide_states" ADD CONSTRAINT "user_guide_states_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
