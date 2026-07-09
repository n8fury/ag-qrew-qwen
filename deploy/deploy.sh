#!/usr/bin/env bash
# AG-QREW on Qwen — one-shot deploy (run from the repo root or deploy/)
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f orchestrator/.env ]; then
  echo "ERROR: orchestrator/.env missing — cp .env.example orchestrator/.env and paste your DASHSCOPE_API_KEY." >&2
  exit 1
fi
if grep -q "YOUR_DASHSCOPE_API_KEY" orchestrator/.env; then
  echo "ERROR: DASHSCOPE_API_KEY still has the placeholder value in orchestrator/.env." >&2
  exit 1
fi

docker compose up --build -d
docker compose ps

echo
echo "✔ demo-app     → http://localhost:3000"
echo "✔ dashboard    → http://localhost:8787   (open it, click Start run, then Proceed)"
