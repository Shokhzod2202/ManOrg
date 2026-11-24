-- Decided 2026-11-24 (replaces open question 3's default): a person may belong to several
-- organizations, for example a contractor's admin who also works in a bakery, or an admin who
-- runs a second organization. Still at most one pending or active membership per organization.
DROP INDEX IF EXISTS "memberships_one_open_per_user";
CREATE UNIQUE INDEX "memberships_one_open_per_user_and_org" ON "memberships" ("user_id", "organization_id")
  WHERE "status" IN ('pending', 'active');
