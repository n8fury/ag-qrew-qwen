# Day 4 — ECS deployment + proof: manual checklist

> Everything below needs a human (Alibaba account, browser, screen recording).
> The repo side is already done: deploy assets fixed, exec bit set, LF pinned,
> README proof-slot ready (`TODO(day-4)` marker). Full click-by-click detail:
> [ecs-setup.md](ecs-setup.md).

## Before touching the cloud

- [ ] `git push origin main` — the instance clones from GitHub, so local commits must be up.
- [ ] Make the repo **public** (GitHub → Settings → Danger Zone) — required for submission
      anyway. Alternative if staying private until Day 7: fine-grained PAT (Contents: read)
      and clone with `https://<PAT>@github.com/n8fury/ag-qrew-qwen.git`.
- [ ] Have the DashScope key handy — **International** Model Studio console (Singapore);
      a mainland Bailian key 401s against the `dashscope-intl` endpoint.

## Create the instance (console → ECS → Create Instance)

- [ ] Pay-as-you-go · Singapore (or nearest) · **2 vCPU / 4 GiB** (e.g. `ecs.e-c1m2.large`)
      · Ubuntu 24.04 64-bit · 40 GiB disk · public IPv4 (pay-by-traffic, 5 Mbps).
- [ ] Security group inbound: **22, 8787** (3000 optional) — authorize to **your IP/32,
      not 0.0.0.0/0**. The dashboard has no auth; an open port lets anyone click
      *Start run* and burn the coupon. Your public IP: https://ifconfig.me
- [ ] Root password or key pair → **Create** → note the public IP.

## Deploy (SSH as root)

- [ ] `apt-get update && apt-get install -y docker.io docker-compose-v2 git && systemctl enable --now docker`
- [ ] Add swap — a 4 GiB box will likely OOM on the Playwright image build without it:
      `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
- [ ] `git clone https://github.com/n8fury/ag-qrew-qwen.git && cd ag-qrew-qwen`
- [ ] `cp .env.example orchestrator/.env` → paste `DASHSCOPE_API_KEY`.
- [ ] `./deploy/deploy.sh` → `docker compose ps` shows **both services Up**.

## Verify + run

- [ ] Open `http://<PUBLIC_IP>:8787` in the local browser → **Start run** → approve at
      **Proceed** → let one full society run finish.
- [ ] State hygiene before any *recorded* run:
      `docker compose restart demo-app && rm -rf qa/* && docker compose restart orchestrator`

## Record the proof (separate from the demo video)

One screen recording, in sequence:

- [ ] ① Alibaba console — the ECS instance page (public IP visible) **and** the Model
      Studio usage page showing token consumption.
- [ ] ② SSH terminal running `docker compose ps`.
- [ ] ③ Live dashboard at `http://<PUBLIC_IP>:8787` streaming signals mid-run.
- [ ] Upload it somewhere linkable (unlisted YouTube works).

## Close out

- [ ] Paste the recording URL into README's Alibaba Cloud section — search for
      `TODO(day-4)`, the slot is ready. Commit + push.
- [ ] Snapshot the system disk (instance → *Disks* → *Create Snapshot*) as insurance.
- [ ] **Do NOT release the instance** — it must stay up until the deadline (~cents/day).
