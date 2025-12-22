-- Add publicKey for project (used to authenticate public widget submissions)
ALTER TABLE "Project" ADD COLUMN "publicKey" TEXT;

-- Backfill existing rows with a non-guessable token without requiring extensions
UPDATE "Project"
SET "publicKey" = md5(random()::text || clock_timestamp()::text)
WHERE "publicKey" IS NULL;

ALTER TABLE "Project" ALTER COLUMN "publicKey" SET NOT NULL;

CREATE UNIQUE INDEX "Project_publicKey_key" ON "Project"("publicKey");
