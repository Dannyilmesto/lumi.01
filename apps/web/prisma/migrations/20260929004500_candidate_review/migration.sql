CREATE TYPE "ExtractionCandidateKind" AS ENUM (
    'BASE_PRICE',
    'SURCHARGE',
    'DISCOUNT',
    'PERCENTAGE_RULE',
    'SHIPPING_OR_PACKAGING',
    'UNCLASSIFIED_AMOUNT'
);

CREATE TYPE "CandidateReviewStatus" AS ENUM (
    'NEEDS_REVIEW',
    'ACCEPTED',
    'REJECTED'
);

ALTER TABLE "PriceList"
ADD COLUMN "extractedAt" TIMESTAMP(3),
ADD COLUMN "extractionSummary" JSONB;

CREATE TABLE "ExtractionCandidate" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "kind" "ExtractionCandidateKind" NOT NULL,
    "reviewStatus" "CandidateReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "pdfPageNumber" INTEGER NOT NULL,
    "printedPageNumber" INTEGER,
    "sectionLabel" TEXT NOT NULL DEFAULT '',
    "sourceExcerpt" TEXT NOT NULL,
    "boundingBox" JSONB NOT NULL,
    "finishCodeCandidates" JSONB NOT NULL DEFAULT '[]',
    "modelCandidates" JSONB NOT NULL DEFAULT '[]',
    "dimensionCandidates" JSONB NOT NULL DEFAULT '[]',
    "amounts" JSONB NOT NULL DEFAULT '[]',
    "percentages" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExtractionCandidate_priceListId_candidateKey_key"
ON "ExtractionCandidate"("priceListId", "candidateKey");

CREATE INDEX "ExtractionCandidate_priceListId_reviewStatus_idx"
ON "ExtractionCandidate"("priceListId", "reviewStatus");

CREATE INDEX "ExtractionCandidate_priceListId_pdfPageNumber_idx"
ON "ExtractionCandidate"("priceListId", "pdfPageNumber");

ALTER TABLE "ExtractionCandidate"
ADD CONSTRAINT "ExtractionCandidate_priceListId_fkey"
FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
