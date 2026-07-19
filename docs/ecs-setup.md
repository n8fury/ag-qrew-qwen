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
   | Port | Purpose | Authorize to |
   |---|---|---|
   | 22 | SSH | your IP (`x.x.x.x/32`) |
   | 8787 | orchestrator dashboard | your IP (`x.x.x.x/32`) |

   (No rule for 3000 — the demo-app is bound to `127.0.0.1` in docker-compose.yml, so it
   is reachable from the instance itself and from the orchestrator over the compose
   network, but never from the internet.)

   **Why not 0.0.0.0/0 for 8787 — not even temporarily:** the dashboard has no
   authentication, and the exposure is worse than "someone spends your tokens":
   `POST /api/run` accepts an arbitrary run context in the request body, and the agents'
   `http_request` tool will fetch whatever URL the run context points them at. On ECS
   that includes the instance metadata endpoint (`http://100.100.100.200`), which can
   serve RAM-role STS credentials — i.e. an open 8787 is an SSRF path into your cloud
   account, not just a token-burner. Restricting to your own IP still satisfies the
   proof recording (it's your browser). If your home IP rotates, widen to your ISP's
   range or update the rule when it changes — it's a 10-second console edit.
9. **Harden the metadata service:** under *Advanced Settings* (or *Instance Metadata* in
   the creation form), set **Instance Metadata Access Mode → Security Hardening mode**
   (token-required / IMDSv2-style). This makes the metadata endpoint unusable by
   simple-GET SSRF even if 8787 is ever misconfigured. On an existing instance:
   Console → the instance → *Actions* → *Modify Instance Metadata Options*.
10. Set a root password (or key pair) → **Create**. Note the public IP.

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
# NOTE: the instance can only clone this if the repo is public (it must be public for
# submission anyway). Until then, clone with a fine-grained PAT (repo → Contents: read):
#   git clone https://<PAT>@github.com/n8fury/ag-qrew-qwen.git
git clone https://github.com/n8fury/ag-qrew-qwen.git
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

## 6. Keep it alive until the deadline

- The instance is pay-as-you-go (~cents/day) — do NOT release it after the recording; the
  live URL is part of the submission.
- Both services carry `restart: unless-stopped`, so an instance reboot (maintenance, OOM
  kill) brings the whole stack back on its own — no SSH needed. Verify once after a
  `reboot` that `docker compose ps` shows both containers Up.
- **Snapshot the system disk as insurance** (Console → the instance → *Disks* → *Create
  Snapshot*) right after the successful run, so a broken instance can be restored in minutes.
- State hygiene before any recorded run (same as local):
  `docker compose restart demo-app && rm -rf qa/* && docker compose restart orchestrator`.

## Troubleshooting

- **`docker compose up` OOMs** — the Playwright image build needs ~2 GiB free; add swap:
  `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`.
- **Dashboard unreachable** — 9 times out of 10 it's the security group, not the app.
  Check inbound 8787 is authorized to the IP you're browsing from (your public IP may
  differ from what you expect — check https://ifconfig.me).
- **401 from Qwen** — your key is from the mainland (Bailian) console; create one in the
  **International** Model Studio console instead (the endpoint in `.env.example` is
  `dashscope-intl`).
