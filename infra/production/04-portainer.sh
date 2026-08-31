#!/usr/bin/env bash
# Portainer: consola web para ver los contenedores, accesible desde el navegador
# pero SOLO desde las IPs que se le pasen.
#
#   bash 04-portainer.sh 181.115.172.42            # una IP
#   bash 04-portainer.sh 181.115.172.42 200.1.2.3  # varias
#
# Sin argumentos vuelve a modo local (solo 127.0.0.1, se llega por tunel ssh).
#
# 🔒 Por que la lista de IPs y no abrirlo a internet: Portainer monta
# /var/run/docker.sock, asi que quien entra puede correr cualquier contenedor y
# es, en la practica, root del servidor. Encima su certificado es autofirmado y
# su pantalla de "crear el primer administrador" queda ABIERTA hasta que alguien
# la completa. Publicarlo entero es regalar la maquina al primer escaneo.
#
# 🪤 Y la restriccion NO se hace con ufw. Docker escribe sus propias reglas de
# iptables y las suyas se evaluan ANTES: un `ufw deny 9443` se ve en
# `ufw status`, parece aplicado, y el puerto sigue abierto al mundo. La unica
# cadena que Docker garantiza consultar primero es DOCKER-USER.
set -euo pipefail

PERMITIDAS=("$@")

echo "==> Instalando Portainer"
docker volume create portainer_data >/dev/null
docker rm -f portainer >/dev/null 2>&1 || true

if [ ${#PERMITIDAS[@]} -eq 0 ]; then
  PUBLICACION="127.0.0.1:9443:9443"
else
  PUBLICACION="9443:9443"
fi

docker run -d \
  --name portainer \
  --restart unless-stopped \
  -p "$PUBLICACION" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest >/dev/null

echo "==> Reglas de acceso al 9443"
# Limpia las reglas de corridas anteriores (se reconocen por el comentario).
while iptables -L DOCKER-USER --line-numbers -n | grep -q 'kobrax-portainer'; do
  n=$(iptables -L DOCKER-USER --line-numbers -n | grep 'kobrax-portainer' | head -1 | awk '{print $1}')
  iptables -D DOCKER-USER "$n"
done

if [ ${#PERMITIDAS[@]} -gt 0 ]; then
  apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  # Se insertan en orden inverso porque -I mete cada una en la posicion 1:
  # primero el DROP general, y encima los ACCEPT de cada IP permitida.
  iptables -I DOCKER-USER -p tcp --dport 9443 -j DROP -m comment --comment kobrax-portainer
  for ip in "${PERMITIDAS[@]}"; do
    iptables -I DOCKER-USER -s "$ip" -p tcp --dport 9443 -j ACCEPT -m comment --comment kobrax-portainer
    echo "    permitida: $ip"
  done
  netfilter-persistent save >/dev/null 2>&1 || echo "    (aviso: las reglas no quedaron persistidas al reinicio)"
fi

echo
echo "===================== RESULTADO ====================="
docker ps --filter name=portainer --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo
echo "Reglas activas en DOCKER-USER:"
iptables -L DOCKER-USER -n --line-numbers | grep -E 'kobrax-portainer|Chain|target' || true
echo
if [ ${#PERMITIDAS[@]} -gt 0 ]; then
  echo "Entrar en:  https://144.126.154.33:9443"
  echo "El certificado es autofirmado: el navegador va a avisar. Aceptalo."
  echo "CREA EL USUARIO ADMINISTRADOR APENAS ENTRES."
else
  echo "Modo local. Tunel:  ssh -L 9443:127.0.0.1:9443 root@144.126.154.33"
  echo "Despues abrir:      https://localhost:9443"
fi
echo "====================================================="
