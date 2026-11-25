-- The owner of an existing organization is its creator, if still an active admin; otherwise the
-- admin who joined first. Both tables force row-level security, which would hide every row from
-- this one-off statement, so the table owner's bypass is used for it and restored right after.
ALTER TABLE "memberships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "organizations" NO FORCE ROW LEVEL SECURITY;

UPDATE "memberships" m SET "owner" = true
FROM (
  SELECT DISTINCT ON (m2.organization_id) m2.id
  FROM "memberships" m2
  JOIN "organizations" o ON o.id = m2.organization_id
  WHERE m2.status = 'active' AND m2.role = 'admin'
  ORDER BY m2.organization_id, (m2.user_id = o.created_by) DESC, m2.created_at ASC
) first_admin
WHERE m.id = first_admin.id;

ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
