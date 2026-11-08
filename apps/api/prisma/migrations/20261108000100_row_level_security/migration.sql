-- Row-level security (CLAUDE.md rule 1, spec section 12).
--
-- The API runs every request inside a transaction that sets, for that transaction only:
--   app.organization_id  the organization of the caller's verified active membership
--   app.user_id          the caller's user id from the verified access token
-- The policies below compare rows with those settings. FORCE makes them apply to the table owner
-- too; only a superuser or a BYPASSRLS role skips them, and the runtime role is neither.
--
-- Not covered (global, no organization_id): users, refresh_tokens, device_tokens.

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- Tables owned by one organization: visible and writable only inside it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shifts', 'punch_events', 'punch_change_requests',
    'products', 'ingredients', 'product_ingredients', 'employee_products',
    'ingredient_assignments', 'ingredient_orders',
    'teams', 'team_members', 'output_entries', 'daily_logs',
    'tasks', 'task_photos'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())',
      t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Tables shared by a bakery (organization_id) and a contractor (contractor_org_id).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contractor_links', 'orders', 'order_lines',
    'deliveries', 'delivery_lines', 'delivery_change_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (organization_id = app_current_org() OR contractor_org_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org() OR contractor_org_id = app_current_org())',
      t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- organizations: the account pool is searchable by any signed-in user (ACC-3);
-- only the organization itself may change its row; nobody deletes one.
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_read ON organizations FOR SELECT
  USING (app_current_user() IS NOT NULL);
CREATE POLICY organizations_create ON organizations FOR INSERT
  WITH CHECK (app_current_user() IS NOT NULL AND created_by = app_current_user());
CREATE POLICY organizations_update ON organizations FOR UPDATE
  USING (id = app_current_org()) WITH CHECK (id = app_current_org());

-- ---------------------------------------------------------------------------
-- memberships: an organization sees its own; a user sees their own across organizations
-- (to find their organization and follow an application). A user may only create a pending
-- employee application for themselves; everything else happens inside the organization.
-- ---------------------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_read ON memberships FOR SELECT
  USING (organization_id = app_current_org() OR user_id = app_current_user());
CREATE POLICY memberships_create ON memberships FOR INSERT
  WITH CHECK (
    organization_id = app_current_org()
    OR (user_id = app_current_user() AND status = 'pending' AND role = 'employee')
  );
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- notifications: read and mark-read by the recipient only; created by the recipient's
-- organization (or for the recipient themselves).
-- ---------------------------------------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_read ON notifications FOR SELECT
  USING (user_id = app_current_user());
CREATE POLICY notifications_create ON notifications FOR INSERT
  WITH CHECK (organization_id = app_current_org() OR user_id = app_current_user());
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());

-- ---------------------------------------------------------------------------
-- audit_log: append-only. An organization reads its own entries; account-level entries
-- (organization_id empty) are written and read by the user they describe.
-- ---------------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_read ON audit_log FOR SELECT
  USING (
    organization_id = app_current_org()
    OR (organization_id IS NULL AND actor_id = app_current_user())
  );
CREATE POLICY audit_log_create ON audit_log FOR INSERT
  WITH CHECK (
    organization_id = app_current_org()
    OR (organization_id IS NULL AND actor_id = app_current_user())
  );

-- ---------------------------------------------------------------------------
-- Grants for the runtime role, when it exists (created by infra/postgres/init in development;
-- provisioned separately in other environments).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT USAGE ON SCHEMA public TO manorg_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO manorg_app;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON TABLE _prisma_migrations FROM manorg_app;
    END IF;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_log FROM manorg_app;
    REVOKE DELETE ON TABLE organizations FROM manorg_app;
    GRANT EXECUTE ON FUNCTION app_current_org() TO manorg_app;
    GRANT EXECUTE ON FUNCTION app_current_user() TO manorg_app;
    -- Tables created by later migrations get the same table grants.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO manorg_app;
  END IF;
END $$;
