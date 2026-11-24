-- Decided 2026-11-24: a repeating task can be for one person, several people, or everyone.
ALTER TABLE "recurring_tasks" ADD COLUMN "assignee_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN "for_all" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "assignee_id" DROP NOT NULL;
