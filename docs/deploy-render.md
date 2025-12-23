# Deploy to Render (mini-crm-core)

This is a minimal checklist for deploying the API to Render and validating it with the built-in smoke test.

## 1) Create Postgres on Render
- Create a Render Postgres database in the same region as your Web Service.
- Copy the **Internal Database URL** and set it as `DATABASE_URL` for the service.

## 2) Create Web Service (from GitHub)
Recommended settings:
- **Build Command**
  - `npm ci && npm run build`
- **Start Command**
  - `node dist/index.js`
- **Health Check Path**
  - `/health`

## 3) Run Prisma migrations on deploy
Add a **Pre-Deploy Command**:
- `npm run prisma:migrate:deploy`

## 4) Environment variables (Render dashboard)
Minimum required:
- `DATABASE_URL` (Render internal URL)
- `JWT_SECRET` (strong random)
- `JWT_EXPIRES_IN` (e.g. `7d`)
- `CORS_ORIGINS` (comma-separated allowlist for admin/web)
- `PUBLIC_CONFIG_RL_MAX`
- `PUBLIC_SUBMIT_RL_MAX`
Optional:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (notifications)

## 5) Post-deploy smoke test
From your local machine:

```bash
BASE=https://<your-render-service-domain> \
SMOKE_ORIGIN=https://<your-site-domain> \
npm run smoke
```

Notes:
- `SMOKE_ORIGIN` must be in your project's allowed-origins allowlist (the smoke script will attempt to add it).
- If you run the CRM behind a custom domain, use that domain as `BASE`.

