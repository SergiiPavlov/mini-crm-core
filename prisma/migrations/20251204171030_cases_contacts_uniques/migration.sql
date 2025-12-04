/*
  Warnings:

  - A unique constraint covering the columns `[id,projectId]` on the table `Case` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,projectId]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('income', 'expense');

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "contactId" INTEGER,
    "caseId" INTEGER,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UAH',
    "category" TEXT,
    "description" TEXT,
    "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_projectId_happenedAt_idx" ON "Transaction"("projectId", "happenedAt");

-- CreateIndex
CREATE INDEX "Transaction_projectId_type_idx" ON "Transaction"("projectId", "type");

-- CreateIndex
CREATE INDEX "Case_projectId_status_idx" ON "Case"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Case_id_projectId_key" ON "Case"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_projectId_key" ON "Contact"("id", "projectId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;
