-- Decided 2026-12-01: ingredient amounts per batch with their own unit, and how many pieces a
-- batch makes. Replaces the quantity per 10 units (spec section 7 assumption).
ALTER TABLE "products" ADD COLUMN "batch_yield" INTEGER;
ALTER TABLE "products" ADD CONSTRAINT "products_batch_yield_positive" CHECK ("batch_yield" IS NULL OR "batch_yield" > 0);
ALTER TABLE "product_ingredients" ADD COLUMN "batch_quantity" DECIMAL(12,3),
ADD COLUMN "batch_unit" "pack_unit";

-- Keep what was entered: a quantity per 10 units is a batch of 10, in the ingredient's pack unit.
-- Row-level security would hide every row from these one-off statements, so the table owner's
-- bypass is used for them only.
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_ingredients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ingredients" NO FORCE ROW LEVEL SECURITY;
UPDATE "product_ingredients" pi
SET "batch_quantity" = pi."quantity_per_10", "batch_unit" = i."pack_unit"
FROM "ingredients" i
WHERE i.id = pi.ingredient_id AND pi."quantity_per_10" IS NOT NULL;
UPDATE "products" p SET "batch_yield" = 10
WHERE EXISTS (
  SELECT 1 FROM "product_ingredients" pi
  WHERE pi.product_id = p.id AND pi."batch_quantity" IS NOT NULL
);
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_ingredients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ingredients" FORCE ROW LEVEL SECURITY;

ALTER TABLE "product_ingredients" DROP COLUMN "quantity_per_10";
