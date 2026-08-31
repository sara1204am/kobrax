#!/usr/bin/env bash
# Prepara la maquina para correr la API y el panel web: Node, pnpm, el clon del
# repo, el .env de la aplicacion y los servicios de systemd.
# Idempotente. Se corre UNA vez; los despliegues posteriores usan deploy.sh.
#
#   ssh root@<IP> 'bash /opt/kobrax/05-app.sh'
set -euo pipefail

APP=/opt/kobrax/app
REPO=https://github.com/sara1204am/kobrax.git

# Dominios publicos. El proxy (06-proxy.sh) los termina con HTTPS y reenvia a
# los puertos locales de abajo.
WEB_PUBLICA=https://kobrax.ikigaisystems.lat
API_PUBLICA=https://api.kobrax.ikigaisystems.lat

# ─── 1. Node 20 y pnpm ──────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  echo "==> Instalando Node 20"
  # El nodejs de los repos de Ubuntu 24.04 es viejo para lo que pide el repo
  # (engines: node >=20), asi que va el repo oficial de NodeSource.
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi
# ponytail: pnpm por corepack, que ya viene con Node. Sin npm -g, y clava la
# version exacta que declara el package.json en vez de "la ultima que haya".
corepack enable
corepack prepare "pnpm@$(node -p "require('$APP/package.json').packageManager.split('@')[1]" 2>/dev/null || echo 9.12.0)" --activate 2>/dev/null || corepack prepare pnpm@9.12.0 --activate

echo "    node $(node -v) / pnpm $(pnpm -v)"

# ─── 2. El clon ─────────────────────────────────────────────────────────────
# El repo es publico: se clona por https y no hace falta ninguna clave.
if [ ! -d "$APP/.git" ]; then
  echo "==> Clonando el repositorio"
  git clone --branch main "$REPO" "$APP"
fi

# ─── 3. El .env de la aplicacion ────────────────────────────────────────────
# Se DERIVA de /opt/kobrax/.env (el de los secretos) en vez de duplicarlo, para
# que las contrasenas vivan en un solo lugar. Se regenera en cada corrida.
echo "==> Escribiendo el .env de la aplicacion"
set -a; . /opt/kobrax/.env; set +a
IP=$(hostname -I | awk '{print $1}')
umask 077
cat > "$APP/.env" <<EOF
# Derivado de /opt/kobrax/.env por 05-app.sh. NO editar a mano.
# Migraciones y seed: superuser. Ver el comentario de .env.example.
DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5434/kobrax?schema=public
# La API en runtime: rol sin BYPASSRLS, sujeto al aislamiento por tenant.
APP_DATABASE_URL=postgresql://kobrax_app:${KOBRAX_APP_PASSWORD}@127.0.0.1:5434/kobrax?schema=public
REDIS_URL=redis://127.0.0.1:6379

JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

APP_ENCRYPTION_KEY=${APP_ENCRYPTION_KEY}
APP_BLIND_INDEX_KEY=${APP_BLIND_INDEX_KEY}

NODE_ENV=production
API_PORT=4010
MOBILE_APP_SCHEME=kobrax

# Las URL PUBLICAS, con https y sin puerto: son las que el navegador y el
# celular ven de verdad. Dejarlas en http://IP:3100 rompe las sesiones apenas el
# proxy sirve por HTTPS — una cookie marcada Secure no viaja por http, y el
# origen que declara SOCKET_CORS_ORIGIN tiene que coincidir EXACTO con el que
# manda el navegador o el websocket del panel se rechaza sin decir por que.
APP_URL=${WEB_PUBLICA}
SOCKET_CORS_ORIGIN=${WEB_PUBLICA}
# Esta NO lleva dominio a proposito: es el salto interno del servidor de Next a
# la API, dentro de la misma maquina. Mandarlo por el dominio publico haria que
# cada peticion del panel saliera a internet y volviera a entrar por el proxy.
KOBRAX_API_URL=http://127.0.0.1:4010/api

# Storage de evidencia: vacio a proposito. Hoy las fotos van al disco local.
# Se llena cuando se conecte Cloudflare R2 (bloqueante §9 #1).
S3_BUCKET=
S3_REGION=auto
S3_ACCESS_KEY=
S3_SECRET_KEY=
EOF
chmod 600 "$APP/.env"

# ─── 4. Servicios de systemd ────────────────────────────────────────────────
# ponytail: systemd y no pm2. Reinicio ante caida, arranque al bootear y logs
# en journalctl ya vienen con el sistema operativo; pm2 seria una dependencia
# mas que instalar, actualizar y vigilar para conseguir lo mismo.
echo "==> Instalando los servicios"
cat > /etc/systemd/system/kobrax-api.service <<EOF
[Unit]
Description=Kobrax API
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=$APP/apps/api
EnvironmentFile=$APP/.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/kobrax-web.service <<EOF
[Unit]
Description=Kobrax panel web
After=network.target kobrax-api.service

[Service]
Type=simple
WorkingDirectory=$APP/apps/web
EnvironmentFile=$APP/.env
# 🪤 next NO esta en apps/web/node_modules/.bin: este repo iza las dependencias
# a la raiz del workspace, y ahi apps/web/node_modules solo tiene @kobrax.
# Apuntarle al .bin de la app da 203/EXEC, que systemd reporta sin decir que
# archivo no encontro. Se invoca con node y la ruta real del paquete, asi no
# depende de donde pnpm decida dejar el enlace.
# 🪤 3100 y no 3000: Nginx Proxy Manager corre en red de host y su backend
# interno escucha en el 3000. Con los dos ahi, el que arranca segundo pierde el
# puerto y la interfaz de NPM (puerto 81) termina pidiendole su API a este
# Next.js — devuelve el panel de Kobrax donde deberia estar la administracion
# del proxy, sin ningun error visible. El puerto de la web es interno: solo lo
# conocen este servicio y el proxy, asi que moverlo no le cambia nada a nadie.
ExecStart=/usr/bin/node $APP/node_modules/next/dist/bin/next start -p 3100
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kobrax-api kobrax-web >/dev/null

echo
echo "===================== RESULTADO ====================="
echo "node    : $(node -v)"
echo "pnpm    : $(pnpm -v)"
echo "repo    : $(cd "$APP" && git log --oneline -1)"
echo "servicios instalados (todavia sin arrancar: falta construir)"
echo "Siguiente: bash /opt/kobrax/deploy.sh"
echo "====================================================="
