# Smoke tests

This repo includes a minimal smoke script to validate the public forms + widget flow.

## Prerequisites

- Running API server (local or hosted).
- `curl` and `node` available in your shell.

If the project uses an Origin allowlist, your browser/test Origin must be in the allowlist.

## Run

From the repo root:

```bash
chmod +x ./scripts/smoke.sh

BASE="http://localhost:4000" \
SLUG="volunteers-odesa-dev" \
PROJECT_KEY="YOUR_PROJECT_KEY" \
ORIGIN="http://localhost:8080" \
EMAIL="owner@example.com" \
PASSWORD="secret123" \
./scripts/smoke.sh
```

### Environment variables

- `BASE` – API base URL (default: `http://localhost:4000`)
- `SLUG` – project slug (required)
- `PROJECT_KEY` – public key for widgets/public endpoints (required)
- `ORIGIN` – Origin to send to public endpoints (default: `http://localhost:8080`)
- `EMAIL`, `PASSWORD` – admin credentials for the “disable form” part (optional; if omitted, this part is skipped)

## What it checks

1. `GET /health` → 200
2. `GET /public/forms/:slug/donation/config` with `Origin` → 200
3. `POST /public/forms/:slug/donation` without required amount → 400 with validation details
4. Email normalization: two lead submits with different email casing → the same `contact.id`
5. Idempotency: repeat lead submit with the same `X-Request-Id` → 201 then 200
6. Allowlist (best-effort): config with unknown Origin should be blocked (403) when allowlist is enabled
7. Disabled form behavior (requires admin login): disable `feedback` form → submit returns 410 → re-enable

## Troubleshooting

- If you see 403 “Origin is required / not allowed”, add your `ORIGIN` to the project allowlist in Admin → Settings → Allowed origins (or via API).
- If you run the widget test page, serve it via `http://localhost:8080` (not `file://`).
