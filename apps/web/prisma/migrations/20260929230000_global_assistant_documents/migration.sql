CREATE TYPE "AssistantDocumentSource" AS ENUM ('UPLOAD', 'PRICE_LIST', 'QUOTE_DOCUMENT');

CREATE TABLE "AssistantDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "fileName" TEXT NOT NULL,
    "originalPdfKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sourceType" "AssistantDocumentSource" NOT NULL DEFAULT 'UPLOAD',
    "sourceId" TEXT,
    "pageCount" INTEGER,
    "documentKind" TEXT,
    "deterministicExtraction" JSONB,
    "semanticExtraction" JSONB,
    "scannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssistantDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantDocument_organizationId_originalPdfKey_key"
ON "AssistantDocument"("organizationId", "originalPdfKey");
CREATE INDEX "AssistantDocument_organizationId_createdAt_idx"
ON "AssistantDocument"("organizationId", "createdAt");
CREATE INDEX "AssistantDocument_organizationId_scannedAt_idx"
ON "AssistantDocument"("organizationId", "scannedAt");
CREATE INDEX "AssistantDocument_organizationId_sourceType_idx"
ON "AssistantDocument"("organizationId", "sourceType");
ALTER TABLE "AssistantDocument"
ADD CONSTRAINT "AssistantDocument_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep every original PDF available to the assistant, but migrate it without
-- the previous scan result so it can be re-read only after a user asks.
INSERT INTO "AssistantDocument" (
    "id", "organizationId", "fileName", "originalPdfKey", "sha256",
    "sourceType", "sourceId", "createdAt", "updatedAt"
)
SELECT
    'price-list-' || pl."id", s."organizationId",
    pl."name" || ' - ' || pl."version" || '.pdf', pl."originalPdfKey",
    pl."sha256", 'PRICE_LIST', pl."id", pl."createdAt", CURRENT_TIMESTAMP
FROM "PriceList" pl
JOIN "Supplier" s ON s."id" = pl."supplierId";

INSERT INTO "AssistantDocument" (
    "id", "organizationId", "uploadedByUserId", "fileName", "originalPdfKey",
    "sha256", "sourceType", "sourceId", "createdAt", "updatedAt"
)
SELECT
    'quote-document-' || qda."id", qda."organizationId", qda."uploadedByUserId",
    qda."sourceFileName", qda."originalPdfKey", qda."sha256",
    'QUOTE_DOCUMENT', qda."id", qda."createdAt", CURRENT_TIMESTAMP
FROM "QuoteDocumentAnalysis" qda;

-- Remove persisted OCR/table/semantic scan outputs. Approved product and price
-- records are intentionally retained; their original PDFs remain accessible.
DELETE FROM "ExtractionCandidate";
DELETE FROM "DocumentPage";
UPDATE "PriceList"
SET "extractedAt" = NULL,
    "extractionSummary" = NULL,
    "status" = CASE
      WHEN "status" IN ('NEEDS_REVIEW', 'PROCESSING', 'FAILED') THEN 'UPLOADED'::"PriceListStatus"
      ELSE "status"
    END;
DELETE FROM "QuoteDocumentAnalysis";
DROP TABLE "QuoteDocumentAnalysis";
DELETE FROM "QuoteParsingProfile";
