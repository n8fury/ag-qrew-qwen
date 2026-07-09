# Alibaba Cloud ECS deployment — click-by-click

Written for someone with zero Alibaba Cloud context. Total time: ~30 minutes.

## 1. Create the ECS instance

1. Console → **Elastic Compute Service (ECS)** → *Instances* → **Create Instance**.
2. Billing: **Pay-as-you-go** (you can release it after the hackathon).
3. Region: pick the one closest to you (Singapore works well from Bangladesh); it does
   NOT need to match the Model Studio region — the API is reached over the internet.
4. Instance type: **2 vCPU / 4 GiB** (e.g. `ecs.e-c1m2.large` or any burstable equivalent).
5. Image: **Ubuntu 24.04 64-bit**.
6. Disk: default 40 GiB system disk is fine (the Playwright image is ~2 GiB).
7. Network: assign a **public IPv4** (pay-by-traffic, 5 Mbps is enough).
8. Security group — open these inbound ports:
   | Port | Purpose |
   |---|---|
   | 22 | SSH |
   | 8787 | orchestrator dashboard |
   | 3000 | demo-app (optional — only if you want it directly reachable) |
9. Set a root password (or key pair) → **Create**. Note the public IP.

## 2. Prepare the instance

```bash
ssh root@<PUBLIC_IP>

# Docker + compose plugin
apt-get update
apt-get install -y docker.io docker-compose-v2 git
systemctl enable --now docker
```

## 3. Deploy

```bash
git clone https://github.com/<your-org>/ag-qrew-qwen.git
cd ag-qrew-qwen

# secrets — paste your DASHSCOPE_API_KEY (International/Singapore Model Studio key)
cp .env.example orchestrator/.env
nano orchestrator/.env

./deploy/deploy.sh          # = docker compose up --build -d
```

## 4. Verify

```bash
docker compose ps                      # both services Up
curl -s localhost:3000 | head -3       # demo-app answers
curl -s localhost:8787/api/state | head -3   # orchestrator answers
```

Then open `http://<PUBLIC_IP>:8787` in your browser → **Start run** → approve the plan at
the **Proceed** checkpoint → watch the signal feed. A full society run takes a few minutes.

## 5. Record the deployment proof (submission requirement)

One short screen recording showing, in sequence:
1. The Alibaba Cloud console: the ECS instance page (public IP visible) and the Model
   Studio console (API key page or model list).
2. A terminal SSH'd into the instance running `docker compose ps`.
3. The dashboard at `http://<PUBLIC_IP>:8787` with a live run streaming signals.

Keep it separate from the demo video. Link both in the README next to
[`orchestrator/src/qwen.ts`](../orchestrator/src/qwen.ts) (the Alibaba Cloud API usage file).

## Troubleshooting

- **`docker compose up` OOMs** — the Playwright image build needs ~2 GiB free; add swap:
  `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`.
- **Dashboard unreachable** — 9 times out of 10 it's the security group, not the app.
  Check inbound 8787 is open to 0.0.0.0/0.
- **401 from Qwen** — your key is from the mainland (Bailian) console; create one in the
  **International** Model Studio console instead (the endpoint in `.env.example` is
  `dashscope-intl`).
