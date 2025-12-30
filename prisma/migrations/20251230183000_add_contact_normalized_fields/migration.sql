/*
  Warnings:

  - A unique constraint covering the columns `[projectId,email_normalized]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[projectId,phone_normalized]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.

*/

-- Add normalized columns
ALTER TABLE "Contact" ADD COLUMN "email_normalized" TEXT;
ALTER TABLE "Contact" ADD COLUMN "phone_normalized" TEXT;

-- Backfill normalized values from existing raw values
UPDATE "Contact"
SET "email_normalized" = lower(trim("email"))
WHERE "email" IS NOT NULL AND trim("email") <> '';

UPDATE "Contact"
SET "phone_normalized" = (
  CASE
    WHEN trim("phone") ~ '^\+' THEN
      '+' || regexp_replace(trim("phone"), '\D', '', 'g')
    ELSE
      regexp_replace(trim("phone"), '\D', '', 'g')
  END
)
WHERE "phone" IS NOT NULL AND trim("phone") <> '';

-- Guard against duplicates before adding unique constraints
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Contact"
    WHERE "email_normalized" IS NOT NULL
    GROUP BY "projectId", "email_normalized"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Contact emails after normalization. Resolve duplicates before applying unique constraint (projectId,email_normalized).';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Contact"
    WHERE "phone_normalized" IS NOT NULL
    GROUP BY "projectId", "phone_normalized"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Contact phones after normalization. Resolve duplicates before applying unique constraint (projectId,phone_normalized).';
  END IF;
END $$;

-- Add unique constraints (PostgreSQL allows multiple NULLs in UNIQUE indexes)
CREATE UNIQUE INDEX "Contact_projectId_email_normalized_key" ON "Contact"("projectId", "email_normalized");
CREATE UNIQUE INDEX "Contact_projectId_phone_normalized_key" ON "Contact"("projectId", "phone_normalized");

-- Helpful lookup indexes
CREATE INDEX "Contact_projectId_email_normalized_idx" ON "Contact"("projectId", "email_normalized");
CREATE INDEX "Contact_projectId_phone_normalized_idx" ON "Contact"("projectId", "phone_normalized");
