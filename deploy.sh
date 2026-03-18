#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-vodkolyan@178.104.34.10}"
APP_DIR="${APP_DIR:-/opt/three-body-problem}"
SERVICE_NAME="${SERVICE_NAME:-three-body-problem}"
BRANCH="${BRANCH:-main}"

git push origin "${BRANCH}"

ssh "${SERVER_HOST}" "
  set -euo pipefail
  sudo -u threebody git -C '${APP_DIR}' fetch origin '${BRANCH}'
  sudo -u threebody git -C '${APP_DIR}' checkout '${BRANCH}'
  sudo -u threebody git -C '${APP_DIR}' pull --ff-only origin '${BRANCH}'
  sudo chown -R threebody:threebody '${APP_DIR}'
  sudo systemctl restart '${SERVICE_NAME}'
  sudo systemctl --no-pager --full status '${SERVICE_NAME}'
"
