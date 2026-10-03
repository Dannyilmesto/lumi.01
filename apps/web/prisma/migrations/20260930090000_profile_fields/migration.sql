CREATE TABLE "UserProfileField" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserProfileField_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserProfileField_userId_label_key" ON "UserProfileField"("userId", "label");
CREATE INDEX "UserProfileField_userId_idx" ON "UserProfileField"("userId");
ALTER TABLE "UserProfileField" ADD CONSTRAINT "UserProfileField_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
