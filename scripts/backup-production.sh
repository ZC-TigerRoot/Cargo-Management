#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

SERVICE_DIR="${SERVICE_DIR:-/www/wwwroot/Cargo-Management}"
BACKUP_ROOT="${BACKUP_ROOT:-/lhcos-data/Cargo_Backup}"
ENV_FILE="${ENV_FILE:-$SERVICE_DIR/shared/.env}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MAX_BACKUPS=5
NODE_BIN="${NODE_BIN:-node}"

WORK_DIR=""

log() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*" >&2
}

die() {
  log "错误：$*"
  exit 1
}

cleanup() {
  local status=$?

  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi

  if (( status != 0 )); then
    log "备份失败，未发布不完整备份"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for command_name in flock pg_dump pg_restore tar sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || die "缺少命令：$command_name"
done

NODE_PATH="$(command -v "$NODE_BIN")" || die "缺少 Node.js 命令：$NODE_BIN"

[[ -f "$ENV_FILE" ]] || die "环境文件不存在：$ENV_FILE"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "RETENTION_DAYS 必须是非负整数"

mkdir -p -- "$BACKUP_ROOT"
chmod 700 -- "$BACKUP_ROOT"

exec 9>"$BACKUP_ROOT/.backup.lock"
flock -n 9 || die "另一个备份任务正在运行"

read_required_env() {
  local name=$1
  local value

  if ! value="$(env -i "$NODE_PATH" --env-file="$ENV_FILE" -e '
    const name = process.argv[1];
    const value = process.env[name];
    if (value === undefined || value === "") process.exit(1);
    process.stdout.write(value);
  ' "$name")"; then
    die "环境文件缺少配置：$name"
  fi

  printf -v "$name" '%s' "$value"
}

read_optional_env() {
  local name=$1
  local fallback=$2
  local value

  value="$(env -i "$NODE_PATH" --env-file="$ENV_FILE" -e '
    const name = process.argv[1];
    process.stdout.write(process.env[name] ?? "");
  ' "$name")"

  printf -v "$name" '%s' "${value:-$fallback}"
}

read_required_env DB_HOST
read_required_env DB_PORT
read_required_env DB_NAME
read_required_env DB_USER
read_required_env DB_PASSWORD
read_optional_env UPLOAD_DIR "$SERVICE_DIR/shared/uploads"

[[ "$UPLOAD_DIR" = /* ]] || die "生产环境 UPLOAD_DIR 必须是绝对路径：$UPLOAD_DIR"
[[ -d "$UPLOAD_DIR" ]] || die "上传目录不存在：$UPLOAD_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
FINAL_DIR="$BACKUP_ROOT/$STAMP"
WORK_DIR="$BACKUP_ROOT/.incomplete-$STAMP-$$"

[[ ! -e "$FINAL_DIR" ]] || die "备份目录已存在：$FINAL_DIR"
mkdir -- "$WORK_DIR"

log "开始备份 PostgreSQL 数据库"
PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$WORK_DIR/database.dump"

pg_restore --list "$WORK_DIR/database.dump" >/dev/null

log "开始备份上传文件"
tar \
  --create \
  --gzip \
  --file="$WORK_DIR/uploads.tar.gz" \
  --directory="$UPLOAD_DIR" \
  .

(
  cd "$WORK_DIR"
  sha256sum database.dump uploads.tar.gz > SHA256SUMS
)

cat > "$WORK_DIR/BACKUP_INFO" <<EOF
created_at=$(date --utc --iso-8601=seconds)
database=$DB_NAME
database_host=$DB_HOST
upload_directory=$UPLOAD_DIR
EOF

mv -- "$WORK_DIR" "$FINAL_DIR"
WORK_DIR=""

ln -sfn -- "$STAMP" "$BACKUP_ROOT/latest"

find "$BACKUP_ROOT" \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -name '20??????-??????' \
  -mtime "+$RETENTION_DAYS" \
  -exec rm -rf -- {} +

mapfile -t BACKUP_DIRS < <(
  find "$BACKUP_ROOT" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -name '20??????-??????' \
    -printf '%f\n' \
    | sort --reverse
)

for ((index = MAX_BACKUPS; index < ${#BACKUP_DIRS[@]}; index++)); do
  rm -rf -- "$BACKUP_ROOT/${BACKUP_DIRS[$index]}"
done

log "备份成功：$FINAL_DIR"
