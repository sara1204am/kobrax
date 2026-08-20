-- El plan pasa a mandar los topes de la cuenta.
--
-- Hasta hoy el único tope que el sistema hacía cumplir era la cantidad de usuarios, y salía de
-- `accounts.max_users`: un número suelto por cuenta que valía 5 en todas, sin mirar el plan. O sea
-- que FREE y BUSINESS tenían exactamente los mismos límites reales.
--
-- Desde acá, los números viven en el catálogo del código (`packages/shared/src/constants/plans.ts`)
-- y la cuenta guarda sólo a qué plan pertenece, más una excepción propia para el cliente que
-- negoció otra cosa (LIMITES-POR-PLAN §8.2). Cambiar lo que incluye un plan deja de ser un UPDATE
-- masivo.

-- 1. El plan gratuito se llamaba STARTER en la base y FREE en la lista de precios. Un nombre.
--    RENAME VALUE conserva el OID del valor, así que el DEFAULT de la columna lo sigue apuntando y
--    pasa a leerse como 'FREE' solo.
ALTER TYPE "PlanCode" RENAME VALUE 'STARTER' TO 'FREE';

-- 2. La excepción negociada. JSONB y no una columna por tope: lo escribe una persona de Kobrax
--    para un cliente puntual, no se filtra ni se ordena por él, y agregar un tope nuevo no puede
--    costar otra migración.
ALTER TABLE "accounts" ADD COLUMN "limits_override" JSONB;

-- 3. 🔴 Nadie pierde asientos al estrenar los planes.
--    Toda cuenta creada antes de hoy tiene 5 asientos porque ese era el valor cableado, no porque
--    alguien lo eligiera. Bajarlas al tope de su plan dejaría a 18 cuentas de prueba —con varios
--    miembros dentro— por encima de su propio techo, y a la pantalla entera diciendo «sin lugar».
--    Es la misma regla que rige al bajar de plan (§8.1): se congela, no se saca.
--
--    Los números del CASE son una foto del catálogo de hoy. No hace falta mantenerlos: esta
--    migración corre una sola vez.
UPDATE "accounts"
SET "limits_override" = jsonb_build_object('users', "max_users")
WHERE "max_users" IS DISTINCT FROM (
  CASE "plan_code"
    WHEN 'FREE' THEN 1
    WHEN 'PROFESSIONAL' THEN 25
    WHEN 'BUSINESS' THEN 100
    WHEN 'ENTERPRISE' THEN 500
  END
);

-- 4. El tope suelto desaparece: si sobreviviera, habría dos fuentes de verdad para el mismo número
--    y la que gana sería la que cada pantalla decidiera leer.
--
--    Se borra en la misma migración porque no hay ninguna versión anterior de la API corriendo en
--    ningún lado: Kobrax todavía no está desplegado. El día que lo esté, esto va en dos pasos —
--    primero dejar de leerla, después borrarla.
ALTER TABLE "accounts" DROP COLUMN "max_users";
