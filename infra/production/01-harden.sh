#!/usr/bin/env bash
# Endurecimiento base del servidor de produccion (PRICING-Y-DEPLOY.md §9 #2).
# Idempotente: se puede correr las veces que haga falta.
#
#   scp infra/production/01-harden.sh root@<IP>:/root/
#   ssh root@<IP> 'bash /root/01-harden.sh'
#
# Requisito previo: la clave SSH ya tiene que estar en ~/.ssh/authorized_keys.
# El script lo verifica antes de apagar el login por contrasena — si no,
# cerrarias la puerta con la llave adentro.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
APT="apt-get -y -qq -o Dpkg::Options::=--force-confold"

echo "==> 0. Verificando que exista una clave SSH antes de tocar nada"
# Acepta la clave este al principio de la linea o detras de opciones
# ("restrict ssh-ed25519 ..."), que es como se instala la clave del CI.
if ! grep -qsE '(^|[ ,])(ssh-(rsa|ed25519|dss)|ecdsa-sha2-)' /root/.ssh/authorized_keys; then
  echo "ABORTADO: /root/.ssh/authorized_keys no tiene ninguna clave." >&2
  echo "Instalala primero o te quedas afuera del servidor." >&2
  exit 1
fi

echo "==> 1. Actualizando el sistema"
apt-get update -qq
$APT upgrade

echo "==> 2. Apagando el login por contrasena"
# 🪤 El nombre del archivo NO es cosmetico. En sshd_config gana la PRIMERA
# aparicion de cada opcion, no la ultima — y la imagen de Ubuntu de Contabo trae
# /etc/ssh/sshd_config.d/50-cloud-init.conf con "PasswordAuthentication yes".
# Un 99-kobrax.conf ordena despues y NO tiene efecto: el script reporta exito y
# la contrasena queda abierta. Tiene que ordenar antes del 50.
rm -f /etc/ssh/sshd_config.d/99-kobrax.conf
cat > /etc/ssh/sshd_config.d/00-kobrax.conf <<'EOF'
# Kobrax: solo clave publica. Una IP de VPS recien creada empieza a recibir
# intentos de fuerza bruta en minutos; sin contrasena no hay nada que adivinar.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t   # valida la config ANTES de reiniciar; si esta rota, aborta aca
systemctl restart ssh

echo "==> 3. Firewall: solo 22, 80 y 443"
# §8: la base de datos, Redis y OSRM NO son accesibles desde internet.
# Solo Caddy habla con el mundo.
$APT install ufw
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Caddy, renovacion de certificado)'
ufw allow 443/tcp comment 'HTTPS (Caddy)'
ufw --force enable

echo "==> 4. Parches de seguridad automaticos"
# ponytail: sin fail2ban. Con PasswordAuthentication=no no hay contrasena que
# adivinar, asi que solo agregaria un demonio mas que mantener. Si algun dia se
# abre otro servicio autenticado por contrasena, ahi si vale la pena.
$APT install unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo
echo "===================== RESULTADO ====================="
echo "SSH  : $(sshd -T | grep -E '^(passwordauthentication|permitrootlogin)' | tr '\n' ' ')"
ufw status verbose | head -6
echo "====================================================="
