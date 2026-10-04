#!/usr/bin/env bash
# Levanta Postgres y Redis de produccion, con secretos reales
# (PRICING-Y-DEPLOY.md §9 #2 y #4).
# Idempotente: se puede correr las veces que haga falta.
#
#   ssh root@<IP> 'bash /opt/kobrax/03-datos.sh'
set -euo pipefail

cd /opt/kobrax

# ─── 1. Secretos ────────────────────────────────────────────────────────────
# 🔴 Se generan UNA SOLA VEZ. APP_ENCRYPTION_KEY cifra los datos sensibles de
# los clientes: si se regenera con datos ya cargados, esos datos quedan
# ilegibles PARA SIEMPRE — ni los respaldos los recuperan (§9 #4). Por eso el
# guard de abajo no es una optimizacion, es lo que impide destruir la cuenta.
if [ -f .env ]; then
  echo "==> .env ya existe — NO se regenera (ver §9 #4)."
else
  echo "==> Generando secretos de produccion por unica vez"
  umask 077
  # Todo en hexadecimal a proposito: estas contrasenas viajan dentro de una
  # DATABASE_URL, y un '/' o un '@' de base64 la parten sin dar error claro.
  cat > .env <<EOF
# Generado por 03-datos.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ). NO versionar.
POSTGRES_PASSWORD=$(openssl rand -hex 24)
KOBRAX_APP_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
APP_BLIND_INDEX_KEY=$(openssl rand -hex 32)
EOF
  chmod 600 .env
fi

set -a; . ./.env; set +a

# ─── 2. Arriba ──────────────────────────────────────────────────────────────
echo "==> Levantando Postgres y Redis"
docker compose -f docker-compose.prod.yml up -d

echo "==> Esperando a que Postgres este sano"
for i in $(seq 1 30); do
  estado=$(docker inspect -f '{{.State.Health.Status}}' kobrax-postgres 2>/dev/null || echo starting)
  [ "$estado" = healthy ] && break
  sleep 2
done
[ "$estado" = healthy ] || { echo "Postgres no arranco (estado: $estado)" >&2; exit 1; }

# ─── 3. La contrasena real del rol de la app ────────────────────────────────
# 01-create-app-role.sql crea kobrax_app con 'kobrax_app_pwd' escrita en el
# codigo. Sirve para desarrollo; en produccion es una contrasena publica que
# esta en el repo. Se la reemplaza aca en vez de tocar el .sql, para no
# romper el arranque de la maquina de desarrollo.
echo "==> Poniendo la contrasena real al rol kobrax_app"
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U postgres -d kobrax \
  -c "ALTER ROLE kobrax_app PASSWORD '${KOBRAX_APP_PASSWORD}'" >/dev/null
echo "    hecho"

# ─── 4. Comprobar que la contrasena del repo quedo muerta ───────────────────
# 🪤 Esta prueba SE HACE DESDE OTRO CONTENEDOR, no con `exec` adentro de
# postgres. La imagen oficial genera un pg_hba.conf con
# "host all all 127.0.0.1/32 trust": conectando a 127.0.0.1 desde adentro NO se
# verifica ninguna contrasena y entra cualquiera, incluso una equivocada. Una
# prueba hecha ahi da verde siempre y no comprueba nada.
echo "==> Comprobando que 'kobrax_app_pwd' (la del repo) ya no sirva"
if docker run --rm --network kobrax_default -e PGPASSWORD=kobrax_app_pwd \
     postgres:15-alpine psql -h postgres -U kobrax_app -d kobrax -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FALLO: la contrasena de desarrollo todavia entra en produccion." >&2
  exit 1
fi
echo "    rechazada, bien"

echo
echo "===================== RESULTADO ====================="
docker compose -f docker-compose.prod.yml ps --format 'table {{.Name}}\t{{.Status}}'
echo
echo "Puertos publicados (deben decir 127.0.0.1, NUNCA 0.0.0.0):"
ss -tlnp | grep -E ':(5434|6379)' | awk '{print "  "$4}'
echo "====================================================="
