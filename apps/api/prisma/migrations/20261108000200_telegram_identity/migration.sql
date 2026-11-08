-- Telegram Mini App identity.
--
-- A person signs in with email and password, or with a Telegram account whose initData
-- the server has checked, or with both after they add a password in Settings.
-- Telegram-only rows have no email and no password. The check keeps a row from having neither.
-- platform_settings is global (like users): it is not organization data and has no RLS.

ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "telegram_user_id" BIGINT;
ALTER TABLE "users" ADD COLUMN "telegram_username" VARCHAR(32);

CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users"("telegram_user_id");

ALTER TABLE "users" ADD CONSTRAINT "users_identity_present"
  CHECK ("email" IS NOT NULL OR "telegram_user_id" IS NOT NULL);

CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE platform_settings TO manorg_app;
  END IF;
END $$;
