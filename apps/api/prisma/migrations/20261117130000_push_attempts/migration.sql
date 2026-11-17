-- Phone push (spec section 9): failed pushes retry three times, then the in-app inbox is enough.
ALTER TABLE "notifications" ADD COLUMN "push_attempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "notifications_push_pending" ON "notifications" ("user_id", "created_at") WHERE "sent_at" IS NULL;
