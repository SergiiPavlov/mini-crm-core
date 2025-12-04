# Mini CRM Core

Backend skeleton for the Mini CRM Core project.

## What is set up so far

- Node.js + TypeScript + Express server (`src/index.ts`) with `/health` endpoint
- Prisma configured with PostgreSQL datasource (`prisma/schema.prisma`)
- Initial data models: Project, User, Contact, Case
- npm scripts for development (`npm run dev`), build, and Prisma commands

## Next steps

- Create a `.env` file with a valid `DATABASE_URL` for PostgreSQL
- Run `npm install`
- Run `npm run prisma:migrate` to apply the initial schema
- Extend the API with routes for projects, contacts and cases

## Projects API (step 2)

Available endpoints so far:

- `GET /projects` — list all projects
- `POST /projects` — create a new project (JSON body: `{ "name": "My Project", "slug": "my-project", "config": { ...optional } }`)

## Prisma setup notes (Prisma v7)

- The Prisma Client is generated into `src/generated/prisma`.
- Run `npm run prisma:generate` after changing `prisma/schema.prisma`.
- For PostgreSQL, the connection string is taken from `DATABASE_URL` in `.env` via `prisma.config.ts`.

## Auth API (step 3)

- `POST /auth/register-owner` — create first owner for a project by `projectSlug`.
  Body: `{ "email": "owner@example.com", "password": "secret123", "projectSlug": "demo" }`
- `POST /auth/login` — login with email/password, returns JWT token.
  Body: `{ "email": "owner@example.com", "password": "secret123" }`
- `GET /auth/me` — get current user (requires `Authorization: Bearer <token>` header).
