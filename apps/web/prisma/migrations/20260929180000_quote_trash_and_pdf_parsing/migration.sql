ALTER TABLE "Quote"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedByUserId" TEXT;

CREATE INDEX "Quote_organizationId_deletedAt_idx"
ON "Quote"("organizationId", "deletedAt");

CREATE TABLE "QuoteParsingProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT,
    "customerId" TEXT,
    "senderKey" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "currency" TEXT,
    "defaultVatRate" DECIMAL(6,3),
    "paymentTerms" TEXT,
    "shippingMode" TEXT,
    "sourceLayout" TEXT,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteParsingProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuoteDocumentAnalysis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "originalPdfKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "documentKind" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "senderName" TEXT,
    "recipientName" TEXT,
    "documentNumber" TEXT,
    "issueDate" TEXT,
    "validUntil" TEXT,
    "currency" TEXT,
    "subtotal" TEXT,
    "discount" TEXT,
    "tax" TEXT,
    "total" TEXT,
    "paymentTerms" TEXT,
    "shippingMode" TEXT,
    "confidence" TEXT NOT NULL,
    "deterministicExtraction" JSONB NOT NULL,
    "semanticExtraction" JSONB NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteDocumentAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuoteParsingProfile_organizationId_senderKey_key"
ON "QuoteParsingProfile"("organizationId", "senderKey");

CREATE INDEX "QuoteParsingProfile_organizationId_supplierId_idx"
ON "QuoteParsingProfile"("organizationId", "supplierId");

CREATE INDEX "QuoteParsingProfile_organizationId_customerId_idx"
ON "QuoteParsingProfile"("organizationId", "customerId");

CREATE INDEX "QuoteDocumentAnalysis_organizationId_createdAt_idx"
ON "QuoteDocumentAnalysis"("organizationId", "createdAt");

CREATE INDEX "QuoteDocumentAnalysis_profileId_createdAt_idx"
ON "QuoteDocumentAnalysis"("profileId", "createdAt");

CREATE INDEX "QuoteDocumentAnalysis_organizationId_sha256_idx"
ON "QuoteDocumentAnalysis"("organizationId", "sha256");

ALTER TABLE "QuoteParsingProfile"
ADD CONSTRAINT "QuoteParsingProfile_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteParsingProfile"
ADD CONSTRAINT "QuoteParsingProfile_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuoteParsingProfile"
ADD CONSTRAINT "QuoteParsingProfile_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuoteDocumentAnalysis"
ADD CONSTRAINT "QuoteDocumentAnalysis_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteDocumentAnalysis"
ADD CONSTRAINT "QuoteDocumentAnalysis_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "QuoteParsingProfile"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
