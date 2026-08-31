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
set -a; . /opt/kobrax/.env; set +a

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

echo "==> 6. Migraciones"
# Solo `migrate deploy`: aplica lo ya commiteado y nada mas. NUNCA `migrate dev`
# (necesita una shadow db que este repo no puede levantar) ni `migrate reset`
# (borra la base entera).
pnpm db:deploy

echo "==> 7. Politicas RLS"
# Ningun script del repo las aplicaba: se venian corriendo a mano. Es el
# bloqueante §9 #5. Son idempotentes por diseno (DROP FUNCTION ... CASCADE y
# recrean todo), asi que se aplican en cada despliegue.
# verify_isolation.sql queda afuera: es una comprobacion, no una politica.
for sql in $(ls -1 "$APP"/packages/database/prisma/rls/*.sql | grep -v verify_isolation | sort); do
  echo "    $(basename "$sql")"
  docker run --rm -i --network kobrax_default -e PGPASSWORD="$POSTGRES_PASSWORD" \
    postgres:15-alpine psql -h postgres -U postgres -d kobrax -v ON_ERROR_STOP=1 -q -f - < "$sql"
done

echo "==> 8. Reiniciando servicios"
systemctl restart kobrax-api
systemctl restart kobrax-web

echo "==> 9. Comprobando que arrancaron"
sleep 5
for s in kobrax-api kobrax-web; do
  if ! systemctl is-active --quiet "$s"; then
    echo "FALLO: $s no quedo activo. Ultimas lineas:" >&2
    journalctl -u "$s" -n 20 --no-pager >&2
    exit 1
  fi
done

echo
echo "===================== RESULTADO ====================="
echo "commit desplegado: $(git log --oneline -1)"
systemctl is-active kobrax-api kobrax-web | paste -d' ' <(echo "api web") -
echo "respaldos guardados: $(ls -1 "$RESPALDOS"/kobrax-*.sql.gz 2>/dev/null | wc -l)"
echo "====================================================="
