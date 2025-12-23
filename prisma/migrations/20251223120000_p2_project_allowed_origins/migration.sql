-- P2-min: per-project CORS allowlist (origins)

CREATE TABLE IF NOT EXISTS "ProjectAllowedOrigin" (
  "id" SERIAL PRIMARY KEY,
  "projectId" INTEGER NOT NULL,
  "origin" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectAllowedOrigin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectAllowedOrigin_projectId_origin_key" ON "ProjectAllowedOrigin"("projectId", "origin");
CREATE INDEX IF NOT EXISTS "ProjectAllowedOrigin_projectId_idx" ON "ProjectAllowedOrigin"("projectId");
