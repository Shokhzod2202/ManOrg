-- "You came to work. Start shift" (spec section 9, phase 2). Only the bakery's own location is
-- stored; employees' locations never reach the server.
ALTER TABLE "organizations" ADD COLUMN "arrival_prompt_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "arrival_window_before_min" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "organizations" ADD COLUMN "arrival_window_after_min" INTEGER NOT NULL DEFAULT 30;
