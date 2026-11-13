-- Decisions of 2026-11-13 (docs/DECISIONS.md).

-- 1. Organizations that sell are "providers" (a bakery, a cake shop, any producer), not only bakeries.
ALTER TYPE "organization_type" RENAME VALUE 'bakery' TO 'provider';

-- 2. The spec's second-version names win (section 7 "Tables added for teams and ingredient ordering").
ALTER TABLE "ingredient_assignments" RENAME TO "ingredient_responsibilities";
ALTER TABLE "ingredient_responsibilities" RENAME CONSTRAINT "ingredient_assignments_pkey" TO "ingredient_responsibilities_pkey";
ALTER TABLE "ingredient_responsibilities" RENAME CONSTRAINT "ingredient_assignments_organization_id_fkey" TO "ingredient_responsibilities_organization_id_fkey";
ALTER TABLE "ingredient_responsibilities" RENAME CONSTRAINT "ingredient_assignments_ingredient_id_organization_id_fkey" TO "ingredient_responsibilities_ingredient_id_organization_id_fkey";

-- ingredient_orders keeps note and fulfilled_by/at from the first version, which ING-5 and ING-6 need.
ALTER TABLE "ingredient_orders" RENAME COLUMN "ordered_by" TO "requested_by";
ALTER TABLE "ingredient_orders" RENAME COLUMN "packs" TO "quantity";
ALTER TABLE "ingredient_orders" RENAME CONSTRAINT "ingredient_orders_packs_positive" TO "ingredient_orders_quantity_positive";

-- 3. Extra powers the admin may grant the AI bot; all off by default.
ALTER TABLE "organizations" ADD COLUMN "bot_access" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_bot_access_object" CHECK (jsonb_typeof("bot_access") = 'object');
