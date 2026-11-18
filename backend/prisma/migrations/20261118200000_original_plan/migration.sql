-- Original (approved) plan: one locked baseline per project, richer snapshots, plan approval stamp.
ALTER TABLE "Baseline" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SNAPSHOT';
ALTER TABLE "Baseline" ADD COLUMN "changeRequestId" UUID;
ALTER TABLE "BaselineItem" ADD COLUMN "title" TEXT;
ALTER TABLE "BaselineItem" ADD COLUMN "type" TEXT;
ALTER TABLE "BaselineItem" ADD COLUMN "assigneeId" UUID;
ALTER TABLE "BaselineItem" ADD COLUMN "phaseId" UUID;
ALTER TABLE "BaselineItem" ADD COLUMN "parentId" UUID;
ALTER TABLE "Project" ADD COLUMN "planApprovedAt" TIMESTAMPTZ(3);
ALTER TABLE "Project" ADD COLUMN "planApprovedById" UUID;

-- At most one original plan per project.
CREATE UNIQUE INDEX "Baseline_projectId_original_key" ON "Baseline"("projectId") WHERE "kind" = 'ORIGINAL';

-- The original plan is read-only at database level: no updates, and no deletes while its project exists
-- (deleting the whole project still cascades).
CREATE OR REPLACE FUNCTION o2_protect_original_baseline() RETURNS trigger AS $$
DECLARE b RECORD;
BEGIN
  IF TG_TABLE_NAME = 'Baseline' THEN
    IF OLD."kind" = 'ORIGINAL' THEN
      IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'The original plan is locked and cannot be changed'; END IF;
      IF EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = OLD."projectId") THEN RAISE EXCEPTION 'The original plan is locked and cannot be deleted'; END IF;
    END IF;
  ELSE
    SELECT "kind" INTO b FROM "Baseline" WHERE "id" = OLD."baselineId";
    IF FOUND AND b."kind" = 'ORIGINAL' THEN RAISE EXCEPTION 'The original plan is locked and cannot be changed'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "Baseline_protect_original" BEFORE UPDATE OR DELETE ON "Baseline" FOR EACH ROW EXECUTE FUNCTION o2_protect_original_baseline();
CREATE TRIGGER "BaselineItem_protect_original" BEFORE UPDATE OR DELETE ON "BaselineItem" FOR EACH ROW EXECUTE FUNCTION o2_protect_original_baseline();
