# Integration (widgets + public forms)

## 1) Get project public key
1. Login: `POST /auth/login`
2. Fetch: `GET /projects/current/integration` → `slug`, `publicKey`

## 2) Allow your site domain (Origin allowlist)
`POST /projects/current/allowed-origins` with JSON: `{ "origin": "https://your-site.com" }`

## 3) Embed a widget on your site
Example (Feedback):
```html
<div id="mini-crm-feedback"></div>
<script src="https://YOUR_CRM_BASE/widget/feedback-form.js"></script>
```

## 4) Public form config (for your front-end)
`GET /public/forms/:projectSlug/:formKey/config`
Headers:
- `X-Project-Key: <publicKey>`
- `Origin: https://your-site.com`

## 5) Smoke against deploy
```bash
BASE=https://YOUR_CRM_BASE SMOKE_ORIGIN=https://your-site.com npm run smoke
```
