-- Ingredient prices become a history in whole won (decided 2026-11-12, see docs/DECISIONS.md).
-- A price edit adds a row effective from that moment, so it only changes future calculations.
-- An ingredient order keeps the price per pack in force when it was placed.

-- CreateTable
CREATE TABLE "ingredient_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "pack_price" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredient_prices_ingredient_id_effective_from_idx" ON "ingredient_prices"("ingredient_id", "effective_from");

-- AddForeignKey
ALTER TABLE "ingredient_prices" ADD CONSTRAINT "ingredient_prices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_prices" ADD CONSTRAINT "ingredient_prices_ingredient_id_organization_id_fkey" FOREIGN KEY ("ingredient_id", "organization_id") REFERENCES "ingredients"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingredient_prices" ADD CONSTRAINT "ingredient_prices_non_negative" CHECK ("pack_price" >= 0);

-- Carry existing prices over as the first history row, rounded to whole won. The owner is subject
-- to forced RLS, so FORCE is lifted on the two tables it reads for this copy only.
ALTER TABLE "ingredients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "organizations" NO FORCE ROW LEVEL SECURITY;
INSERT INTO "ingredient_prices" ("organization_id", "ingredient_id", "pack_price", "effective_from", "created_by")
SELECT i."organization_id", i."id", round(i."pack_price")::integer, i."updated_at", o."created_by"
FROM "ingredients" i JOIN "organizations" o ON o."id" = i."organization_id"
WHERE i."pack_price" IS NOT NULL;
ALTER TABLE "ingredients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "ingredients_pack_price_non_negative";
ALTER TABLE "ingredients" DROP COLUMN "pack_price";

-- AlterTable
ALTER TABLE "ingredient_orders" ADD COLUMN "pack_price" INTEGER;
ALTER TABLE "ingredient_orders" ADD CONSTRAINT "ingredient_orders_pack_price_non_negative" CHECK ("pack_price" IS NULL OR "pack_price" >= 0);

-- Row-level security, as for every table with organization_id.
ALTER TABLE "ingredient_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingredient_prices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ingredient_prices"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());

-- History rows are never edited or removed by the API.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT ON TABLE "ingredient_prices" TO manorg_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "ingredient_prices" FROM manorg_app;
  END IF;
END $$;
