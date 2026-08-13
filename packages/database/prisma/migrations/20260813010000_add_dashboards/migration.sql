-- W8 · Dashboards configurables.
--
-- Un tablero es una FILA, no una pantalla: «Vista general», «Cobranza» y «Campo» son tres filas de
-- `dashboards` con sus widgets. Por eso agregar un tablero nuevo no es programar nada.
--
-- `x/y/w/h` van como columnas y no dentro de `config`: son lo que más se escribe —cada arrastre— y
-- lo único que se va a querer consultar. `config` sí es Json, porque es distinto por tipo de widget.
--
-- ⚠️ **Falta correr `prisma/rls/001_enable_rls.sql`** después de esta migración: las dos tablas
-- llevan `account_id` y su política de aislamiento vive ahí, NO acá. Es la trampa que ya dejó anotada
-- la cartera de W3 — grepear las migraciones buscando la RLS y no encontrarla hace pensar que falta.

CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dashboard_widgets" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "dashboard_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,
    "w" INTEGER NOT NULL DEFAULT 3,
    "h" INTEGER NOT NULL DEFAULT 2,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dashboards_account_id_idx" ON "dashboards"("account_id");
CREATE INDEX "dashboards_deleted_at_idx" ON "dashboards"("deleted_at");
CREATE INDEX "dashboard_widgets_account_id_dashboard_id_idx" ON "dashboard_widgets"("account_id", "dashboard_id");

ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- `CASCADE` acá y no en el resto del esquema: un widget **no existe fuera de su tablero**. Borrar el
-- tablero y dejar sus widgets sueltos sería dejar basura que nadie puede alcanzar ni limpiar.
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_fkey"
  FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
