#!/usr/bin/env bash
# Un despliegue completo: trae main, construye, respalda, migra, aplica RLS y
# reinicia. Lo llama GitHub Actions en cada merge a main, y se puede correr a
# mano igual.
#
#   ssh root@<IP> 'bash /opt/kobrax/deploy.sh'
#
# EL ORDEN NO ES ARBITRARIO:
#   construir ANTES de migrar  -> si el build falla, la base ni se toca
#   respaldar ANTES de migrar  -> una migracion que borra una columna no se deshace
#   reiniciar DESPUES de migrar -> si algo falla antes, sigue corriendo la version vieja
set -euo pipefail

APP=/opt/kobrax/app
RESPALDOS=/opt/kobrax/backups
RETENER=10

cd "$APP"
# Dos archivos, y hacen falta LOS DOS:
#   /opt/kobrax/.env      secretos crudos (POSTGRES_PASSWORD lo usa el paso RLS)
#   /opt/kobrax/app/.env  las URL ya armadas (DATABASE_URL la usa Prisma)
# El segundo lo deriva 05-app.sh del primero. Cargar solo el primero deja a
# `prisma migrate deploy` sin DATABASE_URL, y el error que tira no menciona
# ningun archivo: dice "Environment variable not found" y nada mas.
set -a
. /opt/kobrax/.env
. "$APP/.env"
set +a

: "${DATABASE_URL:?falta DATABASE_URL — corre 05-app.sh para regenerar $APP/.env}"
: "${POSTGRES_PASSWORD:?falta POSTGRES_PASSWORD en /opt/kobrax/.env}"

echo "==> 1. Trayendo main"
git fetch --prune origin
ANTES=$(git rev-parse --short HEAD)
git reset --hard origin/main
AHORA=$(git rev-parse --short HEAD)
echo "    $ANTES -> $AHORA"

echo "==> 2. Dependencias"
# --frozen-lockfile: si el lockfile no coincide con los package.json, FALLA en
# vez de resolver versiones nuevas por su cuenta. Un despliegue no es el momento
# de descubrir que una dependencia cambio de version.
pnpm install --frozen-lockfile

echo "==> 3. Cliente de Prisma"
pnpm db:generate

echo "==> 4. Construyendo"
pnpm build

echo "==> 5. Respaldo de la base ANTES de migrar"
mkdir -p "$RESPALDOS"
ARCHIVO="$RESPALDOS/kobrax-$(date -u +%Y%m%dT%H%M%SZ)-pre-$AHORA.sql.gz"
docker exec kobrax-postgres pg_dump -U postgres --clean --if-exists kobrax | gzip > "$ARCHIVO"
echo "    $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
# ponytail: retencion por conteo, no por fecha. Con despliegues irregulares un
# "borrar lo de mas de 30 dias" puede dejarte sin ningun respaldo; quedarse con
# los ultimos N siempre deja N.
ls -1t "$RESPALDOS"/kobrax-*.sql.gz 2>/dev/null | tail -n +$((RETENER + 1)) | xargs -r rm --
# ponytail: los respaldos viven en el MISMO disco que la base. Alcanza para
# deshacer una migracion, que es de lo que protege este paso. NO alcanza si el
# servidor se muere: para eso falta subirlos a Backblaze B2 (§9 #6), que es
# gasto aparte y va en su propio script.

echo "==> 6. Funcion base de RLS (las migraciones dependen de ella)"
# Ver el encabezado de rls-bootstrap.sql: sin esto, migrar sobre una base vacia
# muere en 20260618160000 con "function app_current_account() does not exist".
docker run --rm -i --network kobrax_default -e PGPASSWORD="$POSTGRES_PASSWORD" \
  postgres:15-alpine psql -h postgres -U postgres -d kobrax -v ON_ERROR_STOP=1 -q -f - \
  < /opt/kobrax/rls-bootstrap.sql

echo "==> 7. Migraciones"
# Solo `migrate deploy`: aplica lo ya commiteado y nada mas. NUNCA `migrate dev`
# (necesita una shadow db que este repo no puede levantar) ni `migrate reset`
# (borra la base entera).
pnpm db:deploy

echo "==> 8. Politicas RLS"
# Ningun script del repo las aplicaba: se venian corriendo a mano. Es el
# bloqueante §9 #5. Son idempotentes por diseno (DROP FUNCTION ... CASCADE y
# recrean todo), asi que se aplican en cada despliegue.
# Los verify_*.sql quedan afuera: son comprobaciones, no politicas (F14 · F9). Antes
# solo se excluia verify_isolation y los tres verify_* que agrego F14 se ejecutaban
# aca como si fueran politicas. Es el mismo criterio de apply-rls.ts. Se corren
# aparte, en el paso 8b, donde un fallo se explica y detiene el despliegue.
for sql in $(ls -1 "$APP"/packages/database/prisma/rls/*.sql | grep -v '/verify_' | sort); do
  echo "    $(basename "$sql")"
  docker run --rm -i --network kobrax_default -e PGPASSWORD="$POSTGRES_PASSWORD" \
    postgres:15-alpine psql -h postgres -U postgres -d kobrax -v ON_ERROR_STOP=1 -q -f - < "$sql"
done

echo "==> 8b. Verificaciones de la base (solo lectura, ANTES de reiniciar)"
# Cada prisma/rls/verify_*.sql aborta con la causa si algo no esta como debe (RLS forzado,
# roles, versiones de autorizacion, plataforma, catalogo de permisos, archivos...). Un
# fallo detiene el despliegue en el mismo punto que una migracion fallida: la base ya se
# migro, pero los servicios NO se reinician y sigue corriendo la version vieja.
# verify_isolation.sql no entra: CREA un tenant de prueba, no es de solo lectura.
# Un archivo que no imprime ninguna comprobacion "OK" tampoco pasa (no verifico nada).
VERIFICACIONES_FALLARON=0
for sql in "$APP"/packages/database/prisma/rls/verify_*.sql; do
  nombre=$(basename "$sql")
  [ "$nombre" = "verify_isolation.sql" ] && continue
  salida=$(docker run --rm -i --network kobrax_default -e PGPASSWORD="$POSTGRES_PASSWORD"     postgres:15-alpine psql -h postgres -U postgres -d kobrax -v ON_ERROR_STOP=1 -q -f - < "$sql" 2>&1) && estado=0 || estado=$?
  comprobaciones=$(printf '%s
' "$salida" | grep -c 'NOTICE:  OK ' || true)
  if [ "$estado" -ne 0 ] || [ "$comprobaciones" -eq 0 ]; then
    echo "    FALLO: $nombre" >&2
    { printf '%s
' "$salida" | grep -E 'ERROR|AVISO' | head -5 | sed 's/^/      /' >&2; } || true
    VERIFICACIONES_FALLARON=1
  else
    echo "    $nombre ($comprobaciones comprobaciones)"
    { printf '%s
' "$salida" | grep 'AVISO' | sed 's/^/      /'; } || true
  fi
done
if [ "$VERIFICACIONES_FALLARON" -ne 0 ]; then
  echo "FALLO: hay verificaciones de la base que no pasan. NO se reinician los servicios: sigue corriendo la version vieja." >&2
  echo "Ver docs/epics/F14/RELEASE-CHECKLIST.md (seccion «Si una verificacion falla»). El respaldo previo esta en $ARCHIVO" >&2
  exit 1
fi

echo "==> 9. Reiniciando servicios"
systemctl restart kobrax-api
systemctl restart kobrax-web

echo "==> 10. Comprobando que arrancaron"
sleep 5
for s in kobrax-api kobrax-web; do
  if ! systemctl is-active --quiet "$s"; then
    echo "FALLO: $s no quedo activo. Ultimas lineas:" >&2
    journalctl -u "$s" -n 20 --no-pager >&2
    exit 1
  fi
done

echo "==> 11. El firewall sigue en pie?"
# Esta guarda existe porque el firewall YA desaparecio una vez sin avisar:
# instalar iptables-persistent desinstala ufw en Ubuntu 24.04 y deja todos los
# puertos abiertos. Un despliegue que deja el servidor expuesto no es un
# despliegue exitoso, aunque la aplicacion levante perfecto.
if ! command -v ufw >/dev/null 2>&1 || ! ufw status | grep -q '^Status: active'; then
  echo "FALLO: ufw no esta instalado o no esta activo. El servidor quedo expuesto." >&2
  echo "Reparar con: bash /opt/kobrax/01-harden.sh" >&2
  exit 1
fi
for puerto in 3000 4010 5434 6379; do
  if ufw status | grep -qE "^${puerto}(/tcp)?[[:space:]]+ALLOW"; then
    echo "FALLO: el puerto $puerto quedo permitido en el firewall." >&2
    exit 1
  fi
done
echo "    activo, y 3000/4010/5434/6379 sin regla de permiso"

echo
echo "===================== RESULTADO ====================="
echo "commit desplegado: $(git log --oneline -1)"
systemctl is-active kobrax-api kobrax-web | paste -d' ' <(echo "api web") -
echo "respaldos guardados: $(ls -1 "$RESPALDOS"/kobrax-*.sql.gz 2>/dev/null | wc -l)"
echo "====================================================="
