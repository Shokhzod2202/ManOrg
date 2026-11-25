-- Decided 2026-11-25: account settings. A person can add a profile picture; an account made
-- through Telegram may have no email or password until the person adds them in Settings.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "password_hash" DROP NOT NULL,
ADD COLUMN "avatar_key" TEXT;
