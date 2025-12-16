Project

Mini CRM Core — a reusable mini-CRM platform (Node/TypeScript backend + Prisma + SQL) with an admin UI. Supports multi-project setup, cases/leads, tasks, contacts, and public forms (/public/forms/...) used by different sites.

Objectives

Build a stable, modular CRM core that can be reused across multiple deployments/projects.

Preserve backward compatibility for existing admin flows and public widgets/forms.

Keep API and data model consistent and well-validated.

Maintain a clean release/PR workflow: small changes, reproducible builds, migrations included.

Non-Negotiable Rules

No manual-only fixes. Terminal is only for diagnosis; final fixes must be in committed code.

No secrets in git. .env.example and docs must be updated; real secrets are environment-level.

If dependencies change, lockfile must be updated and committed.

Any Prisma schema change requires:

a migration,

clear upgrade steps in README/CHANGELOG (if present).

Preserve existing behavior unless explicitly asked to change it.

Required Commands (must pass in PR)

npm ci

npm run build

Prisma projects:

npx prisma generate

npx prisma migrate deploy (when DB available)

Architecture Rules

Keep concerns separated:

routes/controllers (HTTP)

services (business logic)

data access (Prisma)

validation (shared module)

Prefer shared validators and typed DTOs. Avoid duplicating validation rules across routes.

Data & Security

Enforce authentication where required.

Enforce authorization/ownership checks (project scoping, user scoping) consistently.

Validate all external input:

public forms must be hardened against abuse (rate limits, spam checks where applicable).

Return correct error codes:

400 validation,

401 auth missing,

403 forbidden,

404 not found.

Public Forms / Widgets Rules

Public endpoints must be stable and backward compatible.

Data captured from widgets must map correctly into CRM entities (Case/Contact/etc.).

Avoid breaking changes to widget payloads without versioning.

Operational Concerns

Add a lightweight “doctor” script when helpful (env checks, DB connectivity hints).

Add scripts for migrations and setup:

db:migrate, db:status, optionally seed.

PR Format

Each PR must include:

Summary

Testing (exact commands and results)

DB changes (migration name + how to apply)

UI impact (if admin UI changed)

Behavior Preservation Policy

Do not remove existing routes/features without explicit instruction.

For refactors, ensure:

same API contract or documented migration path,

same UI behaviors unless explicitly changed.

What to Do When a Problem Appears

Reproduce with npm ci && npm run build.

If DB-related: prisma migrate status, confirm DATABASE_URL.

Implement a code fix + add a regression check (test or reproducible steps).

Document in README (or CHANGELOG) if behavior changes.
