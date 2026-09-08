#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy: backup remoto -> código versionado -> imagem/API/migrations -> health -> Vercel.
deploy_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$deploy_root"

ssh_config="${CANTINA_SSH_SCRIPT:-/home/jesus/Desktop/Servidores/Server_note/Abre_ssh_normal.sh}"
remote_host="${CANTINA_PROD_HOST:-kali@192.168.0.35}"
remote_dir="${CANTINA_PROD_DIR:-/home/kali/progetos/cantina-stack}"
vercel_scope="${VERCEL_SCOPE:-giusephgangareli-gmailcoms-projects}"

command -v sshpass >/dev/null || { echo "sshpass não encontrado." >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "sqlite3 não encontrado localmente." >&2; exit 1; }
[[ -f "$ssh_config" ]] || { echo "Script SSH ausente: $ssh_config" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || {
    echo "Há alterações locais não versionadas. Faça commit antes do deploy." >&2
    exit 1
}

# O arquivo é fornecido pelo operador e mantém a senha fora do Git.
# shellcheck source=/dev/null
source "$ssh_config"
: "${PASSWORD:?PASSWORD não definida pelo script SSH}"

remote() {
    sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$remote_host" "$@"
}

echo "[1/5] Backup remoto"
remote "CANTINA_REMOTE_DIR=$(printf '%q' "$remote_dir") bash -s" <<'REMOTE'
set -Eeuo pipefail
cd "$CANTINA_REMOTE_DIR"
backup_dir="/home/kali/backups/cantina/deploy-$(date +%Y%m%d-%H%M%S)"
umask 077
mkdir -p "$backup_dir"
sqlite3 data/cantina.db ".backup '$backup_dir/cantina.db'"
tar --exclude=./data --exclude=./uploads --exclude=./node_modules --exclude=./.git -czf "$backup_dir/stack-source.tar.gz" .
printf 'Backup criado: %s\\n' "$backup_dir"
REMOTE

echo "[2/5] Envio do commit $(git rev-parse --short HEAD)"
git archive --format=tar HEAD | sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$remote_host" "cd '$remote_dir' && tar -xf -"

echo "[3/5] Build, migration, reinício da API"
remote "CANTINA_REMOTE_DIR=$(printf '%q' "$remote_dir") bash -s" <<'REMOTE'
set -Eeuo pipefail
cd "$CANTINA_REMOTE_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml build migrate
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-deps --force-recreate api
REMOTE

echo "[4/5] Healthcheck"
remote "bash -s" <<'REMOTE'
set -Eeuo pipefail
for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error http://127.0.0.1:1205/api/v1/health >/dev/null; then
        echo 'API saudável.'
        exit 0
    fi
    sleep 2
done
echo 'API não ficou saudável após o deploy.' >&2
exit 1
REMOTE

echo "[5/5] Vercel produção"
npx --yes vercel deploy --prod --yes --scope "$vercel_scope"
echo "Deploy concluído: $(git rev-parse --short HEAD)"
