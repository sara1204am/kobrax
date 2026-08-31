#!/usr/bin/env bash
# Nginx Proxy Manager: reverse proxy con interfaz web y certificados de
# Let's Encrypt automaticos.
#
#   bash 06-proxy.sh 181.115.172.42      # IP(s) que pueden ver el panel de administracion
#
# 🔑 Corre en RED DE HOST (network_mode: host), y no es un detalle menor:
#
#  1. La API y el panel corren como servicios de systemd EN EL HOST, no en
#     contenedores. Un NPM en red bridge tendria que alcanzarlos por
#     host.docker.internal, y ahi lo frena ufw: "deny incoming" tambien aplica
#     al trafico que viene del puente de docker. Habria que abrir 3000 y 4010
#     a toda la subred de docker — justo lo que no queremos.
#  2. En red de host, los puertos 80/443/81 los abre el propio host, asi que
#     ufw SI los gobierna. Con red bridge, docker escribe sus reglas y se
#     saltea ufw (la misma trampa del 5434 y del 9443).
#
# Resultado: NPM habla con 127.0.0.1:3000 y 127.0.0.1:4010 sin abrir nada, y el
# puerto 81 se restringe con una regla normal de ufw en vez de DOCKER-USER.
set -euo pipefail

PERMITIDAS=("$@")
if [ ${#PERMITIDAS[@]} -eq 0 ]; then
  echo "Uso: bash 06-proxy.sh <IP-que-administra> [otra-IP...]" >&2
  exit 1
fi

echo "==> Levantando Nginx Proxy Manager"
docker rm -f kobrax-npm >/dev/null 2>&1 || true
docker volume create npm_data >/dev/null
docker volume create npm_letsencrypt >/dev/null

docker run -d \
  --name kobrax-npm \
  --restart unless-stopped \
  --network host \
  -v npm_data:/data \
  -v npm_letsencrypt:/etc/letsencrypt \
  jc21/nginx-proxy-manager:latest >/dev/null

echo "==> Firewall"
# 80 y 443 ya estan abiertos desde 01-harden.sh. Falta el 81, el panel de
# administracion, que va SOLO para las IPs indicadas: quien entra ahi puede
# redirigir cualquier dominio a donde quiera y emitir certificados a tu nombre.
ufw --force delete allow 81/tcp >/dev/null 2>&1 || true
for ip in "${PERMITIDAS[@]}"; do
  ufw delete allow from "$ip" to any port 81 proto tcp >/dev/null 2>&1 || true
  ufw allow from "$ip" to any port 81 proto tcp comment 'NPM admin' >/dev/null
  echo "    administracion permitida desde $ip"
done

echo "==> Esperando a que arranque"
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://127.0.0.1:81 && break
  sleep 2
done

echo
echo "===================== RESULTADO ====================="
docker ps --filter name=kobrax-npm --format 'table {{.Names}}\t{{.Status}}'
echo
ss -tlnp | grep -E ':(80|443|81)\b' | awk '{print "  escuchando "$4}'
echo
echo "Panel de administracion:  http://144.126.154.33:81"
echo "Usuario inicial:  admin@example.com  /  changeme"
echo "🔴 CAMBIA ESE USUARIO Y CONTRASENA APENAS ENTRES."
echo "====================================================="
