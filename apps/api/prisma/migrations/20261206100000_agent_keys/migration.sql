-- Decided 2026-11-29: API keys for outside bots (read, or read and write; never delete).
-- CreateTable
CREATE TABLE "agent_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_keys_token_hash_key" ON "agent_keys"("token_hash");

-- CreateIndex
CREATE INDEX "agent_keys_organization_id_idx" ON "agent_keys"("organization_id");

-- AddForeignKey
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_keys"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_access_check" CHECK ("access" IN ('read', 'write'));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "agent_keys" TO manorg_app;
  END IF;
END $$;
