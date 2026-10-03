ALTER TABLE "CalendarEvent"
ADD COLUMN "organizationId" TEXT,
ADD COLUMN "assignedUserId" TEXT;

ALTER TABLE "CalendarEvent"
ADD CONSTRAINT "CalendarEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEvent"
ADD CONSTRAINT "CalendarEvent_assignedUserId_fkey"
FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CalendarEvent_organizationId_date_idx"
ON "CalendarEvent"("organizationId", "date");

CREATE INDEX "CalendarEvent_assignedUserId_idx"
ON "CalendarEvent"("assignedUserId");
