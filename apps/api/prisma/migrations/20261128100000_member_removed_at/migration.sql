-- Decided 2026-11-28: remember when a member was removed, so their earlier shifts, teams and
-- output stay visible (marked removed) and later ones leave them out.
ALTER TABLE "memberships" ADD COLUMN "removed_at" TIMESTAMPTZ(3);

-- Earlier removals: their last change is when they were removed. Row-level security would hide
-- every row from this one-off statement, so the table owner's bypass is used for it only.
ALTER TABLE "memberships" NO FORCE ROW LEVEL SECURITY;
UPDATE "memberships" SET "removed_at" = "updated_at" WHERE "status" = 'removed' AND "removed_at" IS NULL;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
