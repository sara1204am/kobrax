#!/usr/bin/env bash
# Ensayo de actualización (F14 · F9): reproduce lo que hace deploy.sh, pero sobre una COPIA de la base y sin tocar nada de producción.
#
#   # Con un respaldo real (el que deja deploy.sh en /opt/kobrax/backups, o cualquier pg_dump de la base):
#   bash infra/production/release-rehearsal.sh /ruta/kobrax-2026….sql.gz
#
#   # Con una base vacía (migraciones + RLS + seed, como un entorno nuevo):
#   bash infra/production/release-rehearsal.sh --empty
#
#   Opciones:  --db NOMBRE (base de ensayo, por omisión kobrax_rehearsal)   --container NOMBRE (por omisión kobrax-postgres)   --keep (no borrar la base al terminar)
#
# QUÉ HACE, EN ESTE ORDEN (es el de deploy.sh):
#   1. Crea la base de ensayo y restaura el respaldo.
#   2. Cuenta lo que puede DETENER la migración (user_permission_overrides con filas) y vuelca los permisos de ANTES.
#   3. rls-bootstrap → migrate deploy → políticas RLS (sin los verify_*).
#   4. Corre TODAS las verificaciones SQL.
#   5. Vuelca los permisos de DESPUÉS, los compara por rol con los de antes y comprueba que la copia de cada cuenta dice lo mismo que el rol global.
#   6. Lista los clientes que quedaron sin oficina de registro (los rellenos de F14·F2 no pueden decidir los ambiguos).
#   7. Borra la base de ensayo (salvo --keep) y sale con 1 si algo falló.
#
# REQUIERE: docker (el contenedor de Postgres), pnpm, y un .env en la raíz con DATABASE_URL de SUPERUSUARIO (el mismo que usan los demás scripts).
# NO ES UN ENSAYO CON DATOS DE PRODUCCIÓN a menos que se le pase un respaldo de producción.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=kobrax_rehearsal
CONTAINER="${IT_PG_CONTAINER:-kobrax-postgres}"
KEEP=0
EMPTY=0
DUMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --empty) EMPTY=1; shift ;;
    -*) echo "opción desconocida: $1" >&2; exit 2 ;;
    *) DUMP="$1"; shift ;;
  esac
done
# Guardia: el ensayo hace DROP DATABASE ... (FORCE) sobre $DB. Solo se acepta un nombre de ensayo, nunca una base real.
case "$DB" in *rehearsal*) ;; *) echo "--db debe contener «rehearsal» (recibió «$DB»): este script borra esa base" >&2; exit 2 ;; esac
if [ "$EMPTY" = 0 ] && [ -z "$DUMP" ]; then echo "uso: release-rehearsal.sh <respaldo.sql[.gz]> | --empty" >&2; exit 2; fi
if [ "$EMPTY" = 0 ] && [ ! -f "$DUMP" ]; then echo "no existe el respaldo: $DUMP" >&2; exit 2; fi

set -a; . "$ROOT/.env"; set +a
: "${DATABASE_URL:?falta DATABASE_URL en $ROOT/.env}"
# Misma URL, otra base (se reemplaza el último tramo del camino, antes del «?»).
SCRATCH_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#/[^/?]+(\\?|\$)#/${DB}\\1#")"
WORK="$(mktemp -d)"
FAILED=0
REPORT_LINES=()

dpsql() { docker exec -i "$CONTAINER" sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -v ON_ERROR_STOP=${2:-1} -q"; }
# Una consulta de un valor (sin encabezados ni alineación): el SQL entra por la entrada estándar.
dq() { docker exec -i "$CONTAINER" sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -t -A -q"; }
step() { echo; echo "==> $1"; }
fail() { echo "    ✗ $1"; REPORT_LINES+=("✗ $1"); FAILED=1; }
ok() { echo "    ✓ $1"; REPORT_LINES+=("✓ $1"); }
pdb() { (cd "$ROOT" && DATABASE_URL="$SCRATCH_URL" pnpm --silent --filter @kobrax/database "$@"); }
tool() { (cd "$ROOT/packages/database" && DATABASE_URL="$SCRATCH_URL" npx tsx "$@"); }

step "1. Base de ensayo «$DB»"
docker exec -i "$CONTAINER" sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -q -c 'DROP DATABASE IF EXISTS $DB WITH (FORCE)' -c 'CREATE DATABASE $DB'" || { echo "no se pudo crear la base"; exit 1; }
if [ "$EMPTY" = 0 ]; then
  echo "    restaurando $(basename "$DUMP")"
  # ON_ERROR_STOP=0: un respaldo de otra instalación puede traer ALTER OWNER a roles que acá no existen; se cuentan los errores, no se detiene.
  if [[ "$DUMP" == *.gz ]]; then gunzip -c "$DUMP" | dpsql "$DB" 0 2> "$WORK/restore.err" >/dev/null; else dpsql "$DB" 0 < "$DUMP" 2> "$WORK/restore.err" >/dev/null; fi
  ERRS=$(grep -c "ERROR" "$WORK/restore.err" || true)
  if [ "${ERRS:-0}" -gt 0 ]; then echo "    ⚠ la restauración tuvo $ERRS errores (primeros 5):"; grep "ERROR" "$WORK/restore.err" | head -5 | sed 's/^/      /'; fi
  ok "respaldo restaurado ($ERRS errores no bloqueantes)"
fi

if [ "$EMPTY" = 0 ]; then
  step "2. Antes de migrar: lo que puede detener la migración, y los permisos de ANTES"
  OVR=$(printf '%s
' "SELECT CASE WHEN to_regclass('public.user_permission_overrides') IS NULL THEN 0 ELSE (SELECT count(*) FROM user_permission_overrides) END;" | dq "$DB" 2>/dev/null | tr -d '[:space:]')
  if [ "${OVR:-0}" != "0" ]; then fail "user_permission_overrides tiene $OVR filas: la migración que retira esa tabla SE DETENDRÍA (revisarlas antes de desplegar)"; else ok "user_permission_overrides vacía (la migración que la retira no se detiene)"; fi
  if tool prisma/permissions-snapshot.ts dump --legacy --out "$WORK/antes.json" > "$WORK/dump-antes.log" 2>&1; then ok "permisos de antes volcados ($(tail -1 "$WORK/dump-antes.log" | sed 's/^✓ //'))"; else fail "no se pudieron volcar los permisos de antes: $(tail -3 "$WORK/dump-antes.log")"; fi
fi

step "3. Migrar (en el orden de deploy.sh: función base → migraciones → políticas)"
dpsql "$DB" 1 < "$ROOT/infra/production/rls-bootstrap.sql" >/dev/null 2>&1 && ok "rls-bootstrap" || fail "rls-bootstrap falló"
if pdb db:deploy > "$WORK/migrate.log" 2>&1; then ok "migrate deploy ($(grep -c 'applied\|Applying' "$WORK/migrate.log" || true) líneas de migración; $(tail -2 "$WORK/migrate.log" | tr '\n' ' ' | cut -c1-90))"; else fail "migrate deploy FALLÓ:"; tail -12 "$WORK/migrate.log" | sed 's/^/      /'; fi
# Un glob (no `ls`): la ruta del repositorio puede tener espacios. Mismo criterio que apply-rls.ts y que deploy.sh tras F14·F9: todo menos los verify*.
for sql in "$ROOT"/packages/database/prisma/rls/*.sql; do
  case "$(basename "$sql")" in verify*) continue ;; esac
  if dpsql "$DB" 1 < "$sql" >/dev/null 2> "$WORK/rls.err"; then :; else fail "política $(basename "$sql") FALLÓ: $(grep ERROR "$WORK/rls.err" | head -1)"; fi
done
[ "$FAILED" = 0 ] && ok "políticas RLS aplicadas (sin los verify_*)"
if [ "$EMPTY" = 1 ]; then
  pdb db:seed > "$WORK/seed.log" 2>&1 && ok "seed" || { fail "seed FALLÓ"; tail -5 "$WORK/seed.log" | sed 's/^/      /'; }
fi

step "4. Verificaciones de base de datos"
if (cd "$ROOT/packages/database" && npx tsx prisma/run-verify.ts --db "$DB" --container "$CONTAINER") > "$WORK/verify.log" 2>&1; then ok "todas las verificaciones en verde"; sed 's/^/    /' "$WORK/verify.log" | tail -n +3 | head -12; else fail "hay verificaciones que fallan:"; sed 's/^/    /' "$WORK/verify.log"; fi

step "5. Permisos de DESPUÉS"
if tool prisma/permissions-snapshot.ts dump --out "$WORK/despues.json" > "$WORK/dump-despues.log" 2>&1; then
  if [ "$EMPTY" = 0 ] && [ -f "$WORK/antes.json" ]; then
    tool prisma/permissions-snapshot.ts diff "$WORK/antes.json" "$WORK/despues.json" --by-role --allow-any-added > "$WORK/diff.log" 2>&1 && ok "ningún permiso se quitó a nadie" || fail "se quitaron permisos o cambiaron membresías:"
    sed 's/^/    /' "$WORK/diff.log"
  fi
  tool prisma/permissions-snapshot.ts check > "$WORK/check.log" 2>&1 && ok "$(head -1 "$WORK/check.log"): la copia de cada cuenta dice lo mismo que el rol global" || { fail "la copia por cuenta NO dice lo mismo que el rol global:"; sed 's/^/    /' "$WORK/check.log" | head -12; }
else
  fail "no se pudieron volcar los permisos de después: $(tail -3 "$WORK/dump-despues.log")"
fi

if [ "$EMPTY" = 0 ]; then
  step "6. Clientes sin oficina de registro tras los rellenos (informativo: se deciden a mano)"
  printf '%s
' "SELECT 'cuenta ' || account_id || ': ' || COUNT(*) FILTER (WHERE registered_branch_id IS NULL) || ' de ' || COUNT(*) || ' clientes vivos sin oficina de registro' FROM clients WHERE deleted_at IS NULL GROUP BY account_id HAVING COUNT(*) FILTER (WHERE registered_branch_id IS NULL) > 0;" | dq "$DB" 2>/dev/null | sed 's/^/    /'
  echo "    (detalle por cliente: packages/database/prisma/verify/f14-cliente-registro.sql)"
fi

step "7. Limpieza"
if [ "$KEEP" = 1 ]; then echo "    la base «$DB» se conserva (--keep). Informes en $WORK"; else docker exec -i "$CONTAINER" sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -q -c 'DROP DATABASE IF EXISTS $DB WITH (FORCE)'" >/dev/null 2>&1 && echo "    base «$DB» borrada"; fi

echo
if [ "$FAILED" = 0 ]; then echo "✓ ENSAYO SIN PROBLEMAS ($([ "$EMPTY" = 1 ] && echo 'base vacía' || echo "respaldo $(basename "$DUMP")"))"; else echo "✗ EL ENSAYO ENCONTRÓ PROBLEMAS — no desplegar hasta resolverlos"; fi
exit "$FAILED"
