-- Telegram notifications alongside the phone app (decided 2026-11-13).
-- Account-level tables like device_tokens: no organization_id, no tenant rows inside.

CREATE TABLE "telegram_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "username" TEXT,
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_links_user_id_key" ON "telegram_links"("user_id");
CREATE UNIQUE INDEX "telegram_links_chat_id_key" ON "telegram_links"("chat_id");
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telegram_link_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_link_codes_code_hash_key" ON "telegram_link_codes"("code_hash");
CREATE INDEX "telegram_link_codes_user_id_idx" ON "telegram_link_codes"("user_id");
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the bot still has to send, per recipient.
ALTER TABLE "notifications" ADD COLUMN "telegram_sent_at" TIMESTAMPTZ(3);
CREATE INDEX "notifications_telegram_pending" ON "notifications" ("user_id", "created_at") WHERE "telegram_sent_at" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_links", "telegram_link_codes" TO manorg_app;
  END IF;
END $$;
