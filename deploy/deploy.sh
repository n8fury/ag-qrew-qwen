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

# The Playwright image build needs ~2 GiB headroom; a 4 GiB ECS instance without swap
# can OOM mid-build. Warn before it happens (see docs/ecs-setup.md troubleshooting).
if [ -r /proc/meminfo ]; then
  mem_kb=$(awk '/^MemTotal/{print $2}' /proc/meminfo)
  swap_kb=$(awk '/^SwapTotal/{print $2}' /proc/meminfo)
  if [ "$((mem_kb + swap_kb))" -lt 6000000 ]; then
    echo "WARN: <6 GiB RAM+swap — the image build may OOM. Add swap first:"
    echo "  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
  fi
fi

docker compose up --build -d
docker compose ps

echo
echo "✔ demo-app     → http://localhost:3000   (loopback-only — never exposed publicly)"
echo "✔ dashboard    → http://localhost:8787   (open it, click Start run, then Proceed)"
echo "  (on a cloud instance, open the dashboard at http://<PUBLIC_IP>:8787 — inbound 8787"
echo "   must be authorized to your browser's IP in the security group; the demo-app stays"
echo "   loopback-only and needs no inbound rule)"
