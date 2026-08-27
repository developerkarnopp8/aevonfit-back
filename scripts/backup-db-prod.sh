#!/usr/bin/env bash
# Backup diário do banco de produção do AevonFit/PulseRx. Roda direto NA VPS
# (via cron), não da máquina local — dump + gzip + rotação (mantém os
# últimos 14 dias). Restaurar com:
#   gunzip -c <arquivo> | docker exec -i aevonfit-db psql -U postgres aevonfit
set -euo pipefail

BACKUP_DIR="/opt/aevonfit/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/aevonfit_prod_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
docker exec aevonfit-db pg_dump -U postgres aevonfit | gzip > "$OUT_FILE"
echo "Backup salvo em: $OUT_FILE"

# mantém só os 14 backups mais recentes (~2 semanas em cadência diária)
shopt -s nullglob
files=("$BACKUP_DIR"/aevonfit_prod_*.sql.gz)
if [[ ${#files[@]} -gt 14 ]]; then
  printf '%s\n' "${files[@]}" | sort -r | tail -n +15 | xargs -r rm --
fi
