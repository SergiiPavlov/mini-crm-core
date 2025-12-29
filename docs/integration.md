# Integration (widgets + public forms)

## 1) Get project public key + slug
1. Login: `POST /auth/login`
2. Fetch: `GET /projects/current/integration` → `slug`, `publicKey`

## 2) Allow your site domain (Origin allowlist)
Add your production domain (Vercel, etc.):

`POST /projects/current/allowed-origins` with JSON: `{ "origin": "https://your-site.com" }`

## 3) Embed a widget on your site (recommended)
Example (Feedback):

```html
<div id="mini-crm-feedback"></div>
<script
  src="https://YOUR_CRM_BASE/widget/feedback-form.js"
  data-project-slug="YOUR_PROJECT_SLUG"
  data-project-key="YOUR_PUBLIC_KEY"
></script>
```

Notes:
- `data-project-slug` and `data-project-key` are required by the widget.
- If CORS/Origin is not allowlisted, the widget will fail with a CORS error in DevTools → Network.

## 4) Public form config (for your front-end)
`GET /public/forms/:projectSlug/:formKey/config`

Headers:
- `X-Project-Key: <publicKey>`
- `Origin: https://your-site.com`

## 5) Smoke against deploy (Render)
```bash
BASE=https://YOUR_CRM_BASE SMOKE_ORIGIN=https://your-site.com npm run smoke
# optional:
BASE=https://YOUR_CRM_BASE SMOKE_ORIGIN=https://your-site.com SMOKE_INVITES=1 npm run smoke
```
