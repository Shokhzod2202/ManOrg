-- Decided 2026-11-28: private links to the wall screen.

-- CreateTable
CREATE TABLE "wall_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wall_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wall_links_token_hash_key" ON "wall_links"("token_hash");

-- CreateIndex
CREATE INDEX "wall_links_organization_id_idx" ON "wall_links"("organization_id");

-- AddForeignKey
ALTER TABLE "wall_links" ADD CONSTRAINT "wall_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "wall_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wall_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "wall_links"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "wall_links" TO manorg_app;
  END IF;
END $$;
