-- CreateTable
CREATE TABLE "PublicForm" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "formKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicForm_projectId_type_idx" ON "PublicForm"("projectId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PublicForm_projectId_formKey_key" ON "PublicForm"("projectId", "formKey");

-- AddForeignKey
ALTER TABLE "PublicForm" ADD CONSTRAINT "PublicForm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
