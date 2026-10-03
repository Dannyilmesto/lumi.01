CREATE TYPE "QuoteMessageRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "QuoteItemPricingStatus" AS ENUM ('NEEDS_PRICING', 'PRICED');

ALTER TABLE "Quote"
ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Nuovo preventivo';

ALTER TABLE "QuoteItem"
ADD COLUMN "pricingStatus" "QuoteItemPricingStatus" NOT NULL DEFAULT 'NEEDS_PRICING',
ALTER COLUMN "unitPrice" DROP NOT NULL,
ALTER COLUMN "totalPrice" DROP NOT NULL;

UPDATE "QuoteItem"
SET "pricingStatus" = 'PRICED'
WHERE "unitPrice" IS NOT NULL AND "totalPrice" IS NOT NULL;

CREATE TABLE "QuoteMessage" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "role" "QuoteMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuoteMessage_quoteId_createdAt_idx"
ON "QuoteMessage"("quoteId", "createdAt");

ALTER TABLE "QuoteMessage"
ADD CONSTRAINT "QuoteMessage_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "Quote"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
