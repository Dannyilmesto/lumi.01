ALTER TABLE "Customer"
ADD COLUMN "company" TEXT,
ADD COLUMN "postalCode" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "province" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "fiscalCode" TEXT,
ADD COLUMN "vatNumber" TEXT;

CREATE INDEX "Customer_organizationId_name_idx"
ON "Customer"("organizationId", "name");
