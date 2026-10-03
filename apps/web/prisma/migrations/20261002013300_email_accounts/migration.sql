CREATE TYPE "EmailProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailOAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailAccount_userId_provider_email_key"
ON "EmailAccount"("userId", "provider", "email");

CREATE INDEX "EmailAccount_userId_createdAt_idx"
ON "EmailAccount"("userId", "createdAt");

CREATE INDEX "EmailOAuthState_expiresAt_idx"
ON "EmailOAuthState"("expiresAt");

ALTER TABLE "EmailAccount"
ADD CONSTRAINT "EmailAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailOAuthState"
ADD CONSTRAINT "EmailOAuthState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
