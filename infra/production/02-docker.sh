#!/usr/bin/env bash
# Instala Docker Engine + el plugin compose (PRICING-Y-DEPLOY.md §9 #2).
# Idempotente.
#
#   ssh root@<IP> 'bash /root/02-docker.sh'
set -euo pipefail

if command -v docker >/dev/null 2>&1; then
  echo "==> Docker ya esta instalado: $(docker --version)"
else
  echo "==> Instalando Docker desde el instalador oficial"
  # ponytail: el script oficial de Docker en vez de agregar su repo apt a mano.
  # Son 8 pasos (llavero gpg, sources.list, apt-get) contra una linea, y lo
  # publica y firma Docker Inc. Si algun dia hace falta fijar una version
  # exacta, ahi si vale la pena escribir el repo apt completo.
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable --now docker

echo
echo "===================== RESULTADO ====================="
docker --version
docker compose version
echo "====================================================="
