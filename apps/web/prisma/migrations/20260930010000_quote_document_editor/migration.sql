CREATE TABLE "QuoteDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "quoteId" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuoteDocument_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QuoteDocument_quoteId_key" ON "QuoteDocument"("quoteId");
CREATE TABLE "QuoteDocumentRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "documentId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "html" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteDocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "QuoteDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QuoteDocumentRevision_documentId_revision_key" ON "QuoteDocumentRevision"("documentId", "revision");
CREATE TABLE "QuoteDocumentImage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "quoteId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteDocumentImage_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QuoteDocumentImage_quoteId_idx" ON "QuoteDocumentImage"("quoteId");
