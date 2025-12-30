-- Enable case-insensitive text support for PostgreSQL
CREATE EXTENSION IF NOT EXISTS citext;

-- Make User.email case-insensitive at the DB level
ALTER TABLE "User"
  ALTER COLUMN "email" TYPE CITEXT;
