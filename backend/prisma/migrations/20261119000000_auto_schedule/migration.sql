-- Automatic scheduling: a task's start can be fixed ("start no earlier than") or left automatic.
ALTER TABLE "WorkItem" ADD COLUMN "startConstraint" DATE;

-- Keep every existing plan exactly as it is: fix the start of all dated items that have not started.
-- (scripts/upgrade-schedule.js then frees tasks that already start right after the task they wait for,
-- so those follow their predecessors automatically from now on.)
UPDATE "WorkItem" SET "startConstraint" = "plannedStart"
 WHERE "plannedStart" IS NOT NULL AND "type" <> 'MODULE';
