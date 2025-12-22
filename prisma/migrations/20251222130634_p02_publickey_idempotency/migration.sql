-- P0.2: Idempotency for public form submissions

-- Case.clientRequestId (idempotency key)
ALTER TABLE "Case" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "Case_projectId_clientRequestId_key" ON "Case"("projectId", "clientRequestId");
