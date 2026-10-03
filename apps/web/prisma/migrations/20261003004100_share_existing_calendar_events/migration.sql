WITH primary_membership AS (
  SELECT DISTINCT ON ("userId")
    "userId",
    "organizationId"
  FROM "Membership"
  ORDER BY "userId", "createdAt", "id"
)
UPDATE "CalendarEvent" AS event
SET
  "organizationId" = membership."organizationId",
  "assignedUserId" = event."userId"
FROM primary_membership AS membership
WHERE event."userId" = membership."userId"
  AND event."organizationId" IS NULL;
