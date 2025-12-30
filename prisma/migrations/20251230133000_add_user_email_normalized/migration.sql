-- Add a normalized email column to enforce case-insensitive uniqueness without relying on citext.
--
-- Strategy:
-- 1) Add email_normalized (nullable)
-- 2) Backfill from existing email
-- 3) Abort if duplicates exist after normalization
-- 4) Make column NOT NULL
-- 5) Drop old unique constraint on email (case-sensitive) and create unique constraint on email_normalized

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email_normalized" TEXT;

-- If a previous migration converted email to CITEXT, revert it back to TEXT.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = 'email'
      AND udt_name = 'citext'
  ) THEN
    EXECUTE 'ALTER TABLE "User" ALTER COLUMN "email" TYPE TEXT USING "email"::text';
  END IF;
END $$;

-- Backfill (trim + lower)
UPDATE "User"
SET "email_normalized" = LOWER(BTRIM("email"))
WHERE "email_normalized" IS NULL;

-- Fail hard if duplicates exist (case-insensitive)
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT "email_normalized"
    FROM "User"
    GROUP BY "email_normalized"
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot add unique constraint: duplicate normalized emails exist. Resolve duplicates first.';
  END IF;
END $$;

-- Ensure non-null
ALTER TABLE "User" ALTER COLUMN "email_normalized" SET NOT NULL;

-- Drop old unique on email if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'User'
      AND indexname = 'User_email_key'
  ) THEN
    EXECUTE 'DROP INDEX "User_email_key"';
  END IF;
END $$;

-- Create new unique constraint on normalized email
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_normalized_key" ON "User"("email_normalized");
