ALTER TABLE "notifications" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "notifications_dedupe" ON "notifications" ("user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;

ALTER TABLE "tasks" ADD COLUMN "completed_by" UUID;
ALTER TABLE "tasks" ADD COLUMN "capture_token_hash" TEXT;
ALTER TABLE "tasks" ADD COLUMN "capture_token_expires" TIMESTAMPTZ(3);
