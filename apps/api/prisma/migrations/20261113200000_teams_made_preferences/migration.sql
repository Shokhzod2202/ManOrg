-- Decisions of 2026-11-13: admin-made shared teams, "made" ticks on order lines, personal view preferences.
ALTER TABLE "teams" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "order_lines" ADD COLUMN "made_quantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_lines" ADD COLUMN "made_by" UUID;
ALTER TABLE "order_lines" ADD COLUMN "made_at" TIMESTAMPTZ(3);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_made_range" CHECK ("made_quantity" >= 0 AND "made_quantity" <= "quantity");

ALTER TABLE "users" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "users" ADD CONSTRAINT "users_preferences_object" CHECK (jsonb_typeof("preferences") = 'object');
