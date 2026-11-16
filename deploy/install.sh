#!/usr/bin/env bash
# First install on a fresh Ubuntu / Debian server, run from the project folder as root:
#   ./deploy/install.sh
# Installs Docker if needed, creates .env with random secrets, builds and starts Reflect.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  cp .env.example .env
  read -r -p "Domain for Reflect (DNS A record must already point to this server): " domain
  read -r -p "ENCRYPTION_KEY from Replit (Enter for a new one if you are not moving data): " key
  [ -n "$key" ] || key=$(openssl rand -hex 32)
  sed -i "s|^DOMAIN=.*|DOMAIN=$domain|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|; s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$key|" .env
  chmod 600 .env
  echo "Created .env. Add ANTHROPIC_API_KEY there later if you want AI answers."
fi

mkdir -p backups
docker compose build
docker compose up -d db
docker compose run --rm migrate
docker compose up -d
echo
echo "Reflect is starting. In a minute open https://$(grep ^DOMAIN= .env | cut -d= -f2)"
echo "Status: docker compose ps · Logs: docker compose logs -f app"
