ALTER TABLE "PrivateNote" ADD COLUMN "linkedType" TEXT,
ADD COLUMN "linkedId" TEXT;
CREATE INDEX "PrivateNote_linkedType_linkedId_idx" ON "PrivateNote"("linkedType", "linkedId");
