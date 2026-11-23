-- Who can be picked as a project director: a designation set by an administrator in Users & roles.
ALTER TABLE "Membership" ADD COLUMN "projectDirector" BOOLEAN NOT NULL DEFAULT false;

-- Everyone who already directs a project keeps that designation.
UPDATE "Membership" m SET "projectDirector" = true
WHERE m."role" IN ('ADMIN', 'MANAGER')
  AND EXISTS (SELECT 1 FROM "Project" p WHERE p."directorId" = m."userId" AND p."organizationId" = m."organizationId");

-- An administrator may delete a whole project: the original plan may then go with it.
-- (Its rows are still locked while the project exists.)
CREATE OR REPLACE FUNCTION o2_protect_original_baseline() RETURNS trigger AS $$
DECLARE b RECORD;
BEGIN
  IF TG_TABLE_NAME = 'Baseline' THEN
    IF OLD."kind" = 'ORIGINAL' THEN
      IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'The original plan is locked and cannot be changed'; END IF;
      IF EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = OLD."projectId") THEN RAISE EXCEPTION 'The original plan is locked and cannot be deleted'; END IF;
    END IF;
  ELSE
    SELECT bl."kind", bl."projectId" INTO b FROM "Baseline" bl WHERE bl."id" = OLD."baselineId";
    IF FOUND AND b."kind" = 'ORIGINAL' THEN
      IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'The original plan is locked and cannot be changed'; END IF;
      IF EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = b."projectId") THEN RAISE EXCEPTION 'The original plan is locked and cannot be changed'; END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
