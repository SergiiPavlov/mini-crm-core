# Integration (widgets + public forms)

## 1) Get project public key + slug
1. Login: `POST /auth/login`
2. Fetch: `GET /projects/current/integration` → `slug`, `publicKey`

## 2) Allow your site domain (Origin allowlist)
Add your production domain (Vercel, etc.):

`POST /projects/current/allowed-origins` with JSON: `{ "origin": "https://your-site.com" }`

## 3) Embed a widget on your site (recommended)

### New universal widget (button + modal)
Use **one file** `widget.js` and configure it via `data-*` attributes.

Example (Feedback):

```html
<script
  src="https://YOUR_CRM_BASE/widget.js"
  data-api-base="https://YOUR_CRM_BASE"
  data-project-slug="YOUR_PROJECT_SLUG"
  data-project-key="YOUR_PUBLIC_KEY"
  data-form="feedback"
  data-button-text="Залишити відгук"
></script>
```

Other forms (same widget.js, just change `data-form`):
- `lead` (request)
- `donation` (donation)
- `booking` (booking)

You can embed multiple widgets on the same page by adding multiple `<script ...></script>` tags with different `data-form` / `data-button-text`.

### Backward-compatible widgets (no modal)
For legacy usage we still ship dedicated scripts:
- `https://YOUR_CRM_BASE/widget/feedback-form.js`
- `https://YOUR_CRM_BASE/widget/lead-form.js`
- `https://YOUR_CRM_BASE/widget/donation-form.js`
- `https://YOUR_CRM_BASE/widget/booking-form.js`

Notes:
- `data-project-slug` and `data-project-key` are required.
- `data-api-base` is recommended to avoid issues with proxies/CDNs; otherwise the script tries to infer API base from its own `src`.
- If you forget to add your site to `allowedOrigins`, the widget will fail with a CORS error in DevTools → Network.


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
