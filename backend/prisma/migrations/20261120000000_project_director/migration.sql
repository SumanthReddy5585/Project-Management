-- Project governance: every project has a Project Director (approves the plan, documents and change requests)
-- and a Project Manager (builds the plan, runs the team, approves the team's timesheets).
ALTER TYPE "ProjectRole" ADD VALUE IF NOT EXISTS 'DIRECTOR';

ALTER TABLE "Project" ADD COLUMN "directorId" UUID;
-- The plan approval request: the manager sends the plan, the director approves it or sends it back.
ALTER TABLE "Project" ADD COLUMN "planSubmittedAt" TIMESTAMPTZ(3);
ALTER TABLE "Project" ADD COLUMN "planSubmittedById" UUID;
ALTER TABLE "Project" ADD COLUMN "planReturnedAt" TIMESTAMPTZ(3);
ALTER TABLE "Project" ADD COLUMN "planReturnNote" TEXT;
