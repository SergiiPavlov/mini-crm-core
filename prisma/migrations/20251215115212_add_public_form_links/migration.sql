-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "publicFormId" INTEGER;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "publicFormId" INTEGER;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_publicFormId_fkey" FOREIGN KEY ("publicFormId") REFERENCES "PublicForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_publicFormId_fkey" FOREIGN KEY ("publicFormId") REFERENCES "PublicForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
