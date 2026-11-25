-- Decided 2026-11-30: product types and the admin's custom product order.
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type_id" UUID;

-- CreateTable
CREATE TABLE "product_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_types_organization_id_name_key" ON "product_types"("organization_id", "name");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "product_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "product_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_types" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_types"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "product_types" TO manorg_app;
  END IF;
END $$;

-- The custom order starts as A to Z. Row-level security would hide every row from this one-off
-- statement, so the table owner's bypass is used for it only.
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;
UPDATE "products" p SET "sort_order" = ranked.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY lower(name), id) AS n
  FROM "products"
) ranked
WHERE p.id = ranked.id;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
