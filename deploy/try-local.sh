#!/bin/sh
# Starts Reflect for testing at http://localhost:8080 (database + app, no HTTPS, no backups).
#   sh deploy/try-local.sh          start or update after pulling new code
#   sh deploy/try-local.sh stop     stop it (data stays)
#   sh deploy/try-local.sh reset    stop and delete the test database
set -eu
cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.yml -f docker-compose.local.yml"

case "${1:-start}" in
  stop) $compose stop app db; exit 0 ;;
  reset) $compose down -v; rm -f .env; echo "Test setup removed."; exit 0 ;;
esac

if [ ! -f .env ]; then
  cp .env.example .env
  password=$(openssl rand -hex 16)
  key=$(openssl rand -base64 32)
  sed -i.bak \
    -e "s|^DOMAIN=.*|DOMAIN=localhost|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$password|" \
    -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$key|" .env
  rm -f .env.bak
  echo "Created .env with a random password and encryption key (test use only)."
fi

echo "Building (the first time takes a few minutes)..."
$compose build app migrate
$compose up -d db
$compose run --rm migrate
$compose up -d app

printf "Waiting for the app"
for _ in $(seq 1 60); do
  if [ "$(docker inspect --format '{{.State.Health.Status}}' "$($compose ps -q app)" 2>/dev/null)" = "healthy" ]; then
    echo
    echo "Reflect is running: http://localhost:8080"
    echo "In a Codespace, open the Ports tab and click the address next to port 8080."
    exit 0
  fi
  printf "."
  sleep 2
done
echo
echo "The app did not start. Last log lines:" >&2
$compose logs --tail 50 app >&2
exit 1
