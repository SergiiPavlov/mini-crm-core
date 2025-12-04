# Mini CRM Core

Backend skeleton for the Mini CRM Core project.

## What is set up so far

- Node.js + TypeScript + Express server (`src/index.ts`) with `/health` endpoint
- Prisma configured with PostgreSQL datasource (`prisma/schema.prisma`)
- Initial data models: Project, User, Contact, Case
- JWT-based auth with project-scoped users
- Basic CRUD for projects and contacts
- npm scripts for development (`npm run dev`), build, and Prisma commands

## Getting started (local dev)

1. Create a `.env` file with a valid `DATABASE_URL` for PostgreSQL, for example:

   ```env
   DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/mini_crm_core?schema=public"
   PORT=4000
   JWT_SECRET="super-secret-dev-key"
   JWT_EXPIRES_IN="7d"
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Apply migrations (this will create the `mini_crm_core` database if needed):

   ```bash
   npm run prisma:migrate
   ```

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Check that the API is running:

   ```http
   GET http://localhost:4000/health
   ```

## Prisma setup notes (Prisma v7)

- The Prisma Client is generated into `src/generated/prisma`.
- Run `npm run prisma:generate` after changing `prisma/schema.prisma`.
- For PostgreSQL, the connection string is taken from `DATABASE_URL` in `.env` via `prisma.config.ts`.

## Auth API (step 3)

- `POST /auth/register-owner` — create first owner for a project by `projectSlug`.
  Body:

  ```json
  { "email": "owner@example.com", "password": "secret123", "projectSlug": "demo" }
  ```

- `POST /auth/login` — login with email/password, returns JWT token.
  Body:

  ```json
  { "email": "owner@example.com", "password": "secret123" }
  ```

- `GET /auth/me` — get current user (requires `Authorization: Bearer <token>` header).

## Projects API

- `GET /projects` — list all projects.
- `POST /projects` — create a project.

  Body:

  ```json
  { "name": "Demo CRM Project", "slug": "demo" }
  ```

## Contacts API (step 4)

All endpoints require `Authorization: Bearer <token>` and are automatically scoped to the current user's `projectId`.

- `GET /contacts` — list contacts for the current project.
- `GET /contacts/:id` — get a single contact (includes related cases).
- `POST /contacts` — create a new contact.

  Body example:

  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+380000000000",
    "notes": "Came from landing form"
  }
  ```

- `PATCH /contacts/:id` — update an existing contact (any subset of fields `name`, `email`, `phone`, `notes`).
- `DELETE /contacts/:id` — delete a contact belonging to the current project.

This is the base for further steps: cases, tasks and public forms for embedding on external sites.


## Public forms (lead capture)

Public, unauthenticated endpoint for embedding on external sites:

- `POST /public/forms/:projectSlug/lead`

Example body:

```json
{
  "name": "Lead from landing",
  "email": "lead@example.com",
  "phone": "+380000000000",
  "message": "Хочу консультацию по сайту",
  "source": "landing-psor"
}
```

The endpoint will:
- resolve `projectSlug` to a Project,
- create a Contact in that project,
- try to create a Case (if the Case model is available),
- return both the created contact and case (or `case: null` on failure).

## Embed widget on any site

You can embed a ready-made lead form widget on any external site.

1. Make sure you have a Project with a known `slug` (for example `"demo"`).
2. Your CRM backend must be accessible from the public internet (for example on Render).

Then add this snippet to the client's site:

```html
<div id="lead-widget"></div>
<script
  src="https://YOUR_CRM_BASE_URL/widget/lead-form.js"
  data-project-slug="demo"
  data-source="landing-psor"
></script>
```

- `data-project-slug` — which Project in Mini CRM should receive leads.
- `data-source` — optional label to see where leads come from (e.g. `landing-psor`, `portfolio-site`, etc.).

The script will:
- inject a small styled form after the `<script>` tag,
- send `POST` requests to `/public/forms/:projectSlug/lead`,
- show success / error messages to the user.

## Security & hardening

- **Validation** — all mutating endpoints (`/projects`, `/auth/*`, `/contacts`, `/public/forms/:projectSlug/lead`) validate input with Zod. Invalid payloads return `400` with a short description.
- **Auth** — private routes (`/projects`, `/contacts`, `/auth/me`) require a JWT in `Authorization: Bearer <token>` signed with `JWT_SECRET`.
- **Rate limiting** — login & owner registration are limited per IP (15 minutes window), public lead forms are limited per IP per minute. This protects from basic brute-force and spam.
- **CORS** — in production, set environment variable `CORS_ORIGINS` to a comma-separated list of allowed origins (e.g. `https://admin.yoursite.com,https://landing.yoursite.com`). In dev, if `CORS_ORIGINS` is empty, any origin is allowed.
- **Honeypot** — public lead form includes a hidden field. If a bot fills it, the API responds with success but silently ignores the lead. This reduces spam from simple bots.

## Cases API

All `/cases` endpoints work in the context of the current user's project (from JWT).

- `GET /cases` — list cases, optional query params:
  - `status` — single status or comma-separated list, e.g. `new,in_progress`
  - `dateFrom` / `dateTo` — ISO date strings to filter by `createdAt` range.
- `POST /cases` — create a case.
  - Body JSON:
    ```json
    {
      "title": "Need website redesign",
      "description": "Landing page + blog",
      "status": "new",
      "source": "landing-form",
      "contactId": 1
    }
    ```
- `PATCH /cases/:id` — update a case (any subset of fields).
- `DELETE /cases/:id` — delete a case.

Notes:
- `contactId` (if provided) must belong to the same project as the user, otherwise `404` is returned.
- If `status` is omitted on create, it defaults to `"new"`.

## Transactions API (simple finance layer)

All `/transactions` endpoints work in the context of the current user's project (from JWT).

### List transactions

- `GET /transactions` — list transactions with optional filters:

  Query params:
  - `type` — `"income"` or `"expense"`
  - `category` — string
  - `dateFrom` / `dateTo` — ISO date strings (filter by `happenedAt`)
  - `minAmount` / `maxAmount` — numeric filters on `amount`

### Summary

- `GET /transactions/summary` — returns simple totals for the current project.

  Query params (optional):
  - `category` — filter by category
  - `dateFrom` / `dateTo` — date range

  Response example:
  ```json
  {
    "totalIncome": 15000,
    "totalExpense": 4200,
    "net": 10800
  }
  ```

### Create transaction

- `POST /transactions` — create a transaction (income/expense).

  Body JSON example:
  ```json
  {
    "type": "income",
    "amount": 5000,
    "currency": "UAH",
    "category": "donation",
    "description": "Private donor via bank",
    "contactId": 1,
    "caseId": 2,
    "happenedAt": "2025-01-10T12:34:56.000Z"
  }
  ```

### Update transaction

- `PATCH /transactions/:id` — update any subset of fields.

### Delete transaction

- `DELETE /transactions/:id` — delete a transaction.

Notes:
- `contactId` and `caseId` (if provided) must belong to the same project as the user, otherwise `404` is returned.
- `amount` is stored as a decimal value in the database; the API accepts numbers.
- If `currency` is omitted, it defaults to `"UAH"`.


## Public forms API & widgets

### Lead form (existing)

Endpoint:
- `POST /public/forms/:projectSlug/lead`

Body JSON:
- `name` (optional)
- `email` (optional)
- `phone` (optional)
- `message` (optional)
- `source` (optional)
- `__hp` — honeypot field (if filled, request is accepted but ignored)

Widget usage (lead form):

```html
<div id="lead-widget"></div>
<script
  src="https://YOUR_CRM_BASE_URL/widget/lead-form.js"
  data-project-slug="demo"
  data-source="landing-widget"
></script>
```

### Donation form

Endpoint:
- `POST /public/forms/:projectSlug/donation`

Body JSON:
- `name` / `email` / `phone` — хотя бы одно из этих полей обязательно
- `amount` — число > 0 (сумма в UAH)
- `message` — комментарий к пожертвованию (опционально)
- `source` — источник формы (опционально, по умолчанию `"donation-widget"`)
- `__hp` — honeypot

Поведение:
- Находит или создаёт контакт (`Contact`) для проекта.
- Опционально создаёт `Case` с заголовком `"Нове пожертвування з сайту"`.
- Создаёт `Transaction` с типом `income`, категорией `"donation"` и переданной суммой.

Пример виджета (donation):

```html
<div id="donation-widget"></div>
<script
  src="https://YOUR_CRM_BASE_URL/widget/donation-form.js"
  data-project-slug="demo"
  data-source="donation-widget"
></script>
```

### Booking form

Endpoint:
- `POST /public/forms/:projectSlug/booking`

Body JSON:
- `name` / `email` / `phone` — хоча б одне з цих полів обовʼязкове
- `service` — що саме бронюємо (опціонально)
- `date` / `time` — дата та час (рядки, опціонально)
- `message` — деталі запиту (опціонально)
- `source` — джерело форми (опціонально, за замовчуванням `"booking-widget"`)
- `__hp` — honeypot

Поведення:
- Знаходить або створює `Contact`.
- Створює `Case` з заголовком `"Нове бронювання з сайту"` і зібраними деталями.

Приклад віджета:

```html
<div id="booking-widget"></div>
<script
  src="https://YOUR_CRM_BASE_URL/widget/booking-form.js"
  data-project-slug="demo"
  data-source="booking-widget"
></script>
```

### Feedback form

Endpoint:
- `POST /public/forms/:projectSlug/feedback`

Body JSON:
- `name` / `email` / `phone` — хоча б одне із цих полів обовʼязкове
- `message` — обовʼязковий текст відгуку
- `rating` — число від 1 до 5 (опціонально)
- `source` — джерело форми (опціонально, за замовчуванням `"feedback-widget"`)
- `__hp` — honeypot

Поведення:
- Знаходить або створює `Contact`.
- Створює `Case` з заголовком `"Новий відгук з сайту"` і описом з оцінки + тексту відгуку.

Приклад віджета:

```html
<div id="feedback-widget"></div>
<script
  src="https://YOUR_CRM_BASE_URL/widget/feedback-form.js"
  data-project-slug="demo"
  data-source="feedback-widget"
></script>
```
