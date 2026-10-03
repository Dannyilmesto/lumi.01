CREATE TYPE "CatalogProductPricingMode" AS ENUM ('AREA', 'FIXED');

CREATE TABLE "QuoteCatalogProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricingMode" "CatalogProductPricingMode" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "minimumBillableArea" DECIMAL(10,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteCatalogProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuoteCatalogProduct_organizationId_name_idx"
ON "QuoteCatalogProduct"("organizationId", "name");

ALTER TABLE "QuoteCatalogProduct"
ADD CONSTRAINT "QuoteCatalogProduct_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
