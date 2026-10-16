#!/bin/bash
# Export EspoCRM MySQL tables to NDJSON — reads ONLY the local DB on tapdata,
# no Zoho/network involved. Uses the mysql CLI, so no driver packages needed.
#
# Usage (on tapdata):
#   bash scripts/migration/export-espo-ndjson.sh              # all default tables
#   bash scripts/migration/export-espo-ndjson.sh account lead  # subset
#
# Output: scripts/migration/data/espo/<table>.ndjson + manifest.tsv (table<TAB>rows)
set -euo pipefail

ENV_FILE="${ENV_FILE:-$HOME/app/espocrm-deploy/db.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"

export MYSQL_PWD="$ESPO_PW"
MYSQL=(mysql -h127.0.0.1 -P3308 -uespo -N -B -r --default-character-set=utf8mb4 espocrm)

OUT_DIR="${OUT_DIR:-$(cd "$(dirname "$0")" && pwd)/data/espo}"
mkdir -p "$OUT_DIR"
MANIFEST="$OUT_DIR/manifest.tsv"
: > "$MANIFEST"

if [ "$#" -gt 0 ]; then
  TABLES=("$@")
else
  TABLES=(
    user role role_user
    account account_contact
    contact contact_opportunity
    entity_email_address entity_phone_number email_address phone_number
    opportunity lead task call meeting campaign
    note attachment
    tapdata_product tapdata_quote tapdata_quote_item
    tapdata_contract tapdata_contract_item tapdata_contract_receipt
  )
fi

for t in "${TABLES[@]}"; do
  mapfile -t cols < <("${MYSQL[@]}" -e \
    "SELECT column_name FROM information_schema.columns
     WHERE table_schema='espocrm' AND table_name='$t' ORDER BY ordinal_position;")
  if [ "${#cols[@]}" -eq 0 ]; then
    echo "SKIP missing table: $t" >&2
    continue
  fi

  parts=()
  for c in "${cols[@]}"; do
    parts+=("'$c'")
    parts+=("\`$c\`")
  done
  expr=$(IFS=,; echo "${parts[*]}")

  has_deleted=$("${MYSQL[@]}" -e \
    "SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='espocrm' AND table_name='$t' AND column_name='deleted';")
  where=""
  [ "$has_deleted" = "1" ] && where="WHERE \`deleted\`=0"

  "${MYSQL[@]}" -e "SELECT JSON_OBJECT($expr) FROM \`$t\` $where;" \
    > "$OUT_DIR/$t.ndjson"

  n=$(wc -l < "$OUT_DIR/$t.ndjson" | tr -d ' ')
  printf '%s\t%s\n' "$t" "$n" >> "$MANIFEST"
  echo "$t -> $n"
done

echo "--- manifest: $MANIFEST"
