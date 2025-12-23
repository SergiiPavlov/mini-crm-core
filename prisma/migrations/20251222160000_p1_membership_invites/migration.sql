-- P1: Membership + ProjectInvite (multi-tenant admin isolation)

-- 1) Create enum for per-project roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MembershipRole') THEN
    CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'viewer');
  END IF;
END $$;

-- 2) Project: add createdByUserId (nullable)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "createdByUserId" INTEGER;

-- 3) Membership table
CREATE TABLE IF NOT EXISTS "Membership" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "projectId" INTEGER NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  BEGIN
    ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE "Membership" ADD CONSTRAINT "Membership_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Membership_userId_projectId_key" ON "Membership" ("userId", "projectId");
CREATE INDEX IF NOT EXISTS "Membership_projectId_idx" ON "Membership" ("projectId");

-- 4) Backfill Membership from legacy User.projectId/User.role (if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'projectId'
  ) THEN
    INSERT INTO "Membership" ("userId","projectId","role","createdAt","updatedAt")
    SELECT
      u."id",
      u."projectId",
      CASE
        WHEN u."role" IN ('owner','admin','viewer') THEN u."role"::"MembershipRole"
        ELSE 'viewer'::"MembershipRole"
      END,
      NOW(),
      NOW()
    FROM "User" u
    ON CONFLICT ("userId","projectId") DO NOTHING;
  END IF;
END $$;

-- 5) Backfill Project.createdByUserId from first owner membership
UPDATE "Project" p
SET "createdByUserId" = m."userId"
FROM (
  SELECT DISTINCT ON ("projectId") "projectId", "userId"
  FROM "Membership"
  WHERE "role" = 'owner'
  ORDER BY "projectId", "userId"
) m
WHERE p."id" = m."projectId" AND p."createdByUserId" IS NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- 6) ProjectInvite table
CREATE TABLE IF NOT EXISTS "ProjectInvite" (
  "id" SERIAL PRIMARY KEY,
  "projectId" INTEGER NOT NULL,
  "token" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "expiresAt" TIMESTAMPTZ,
  "usedAt" TIMESTAMPTZ,
  "usedByUserId" INTEGER,
  "createdByUserId" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectInvite_token_key" ON "ProjectInvite" ("token");
CREATE INDEX IF NOT EXISTS "ProjectInvite_projectId_usedAt_idx" ON "ProjectInvite" ("projectId", "usedAt");

DO $$
BEGIN
  BEGIN
    ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_usedByUserId_fkey"
      FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- 7) Drop legacy columns from User (role/projectId) if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'projectId'
  ) THEN
    BEGIN
      ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_projectId_fkey";
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    ALTER TABLE "User" DROP COLUMN IF EXISTS "projectId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'role'
  ) THEN
    ALTER TABLE "User" DROP COLUMN IF EXISTS "role";
  END IF;
END $$;
