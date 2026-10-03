ALTER TYPE "EmailProvider" ADD VALUE 'IMAP_SMTP';
ALTER TYPE "EmailProvider" ADD VALUE 'DEMO';

ALTER TABLE "EmailAccount"
ADD COLUMN "configEncrypted" TEXT;

CREATE TABLE "EmailDemoMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDemoMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailDemoMessage_accountId_folder_createdAt_idx"
ON "EmailDemoMessage"("accountId", "folder", "createdAt");

ALTER TABLE "EmailDemoMessage"
ADD CONSTRAINT "EmailDemoMessage_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
