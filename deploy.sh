#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-root@178.104.34.10}"
APP_DIR="${APP_DIR:-/opt/three-body-problem}"
SERVICE_NAME="${SERVICE_NAME:-three-body-problem}"
BRANCH="${BRANCH:-main}"

git push origin "${BRANCH}"

ssh "${SERVER_HOST}" "
  set -euo pipefail
  cd '${APP_DIR}'
  git fetch origin '${BRANCH}'
  git checkout '${BRANCH}'
  git pull --ff-only origin '${BRANCH}'
  chown -R threebody:threebody '${APP_DIR}'
  systemctl restart '${SERVICE_NAME}'
  systemctl --no-pager --full status '${SERVICE_NAME}'
"
