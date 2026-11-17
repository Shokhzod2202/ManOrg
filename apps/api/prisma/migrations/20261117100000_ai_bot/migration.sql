-- AI bot manager (spec section 10, phase 2). Every table belongs to one organization.

CREATE TABLE "bot_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_conversations_id_organization_id_key" ON "bot_conversations"("id", "organization_id");
CREATE INDEX "bot_conversations_organization_id_user_id_updated_at_idx" ON "bot_conversations"("organization_id", "user_id", "updated_at");
ALTER TABLE "bot_conversations" ADD CONSTRAINT "bot_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every turn, tool call and result, kept 90 days for review.
CREATE TABLE "bot_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "native" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_messages_conversation_id_seq_key" ON "bot_messages"("conversation_id", "seq");
CREATE INDEX "bot_messages_organization_id_created_at_idx" ON "bot_messages"("organization_id", "created_at");
ALTER TABLE "bot_messages" ADD CONSTRAINT "bot_messages_conversation_id_organization_id_fkey" FOREIGN KEY ("conversation_id", "organization_id") REFERENCES "bot_conversations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A write the bot proposed; nothing changes until the admin confirms (twice above 20 rows).
CREATE TABLE "bot_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "rows" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bot_proposals_status_check" CHECK ("status" IN ('pending', 'applied', 'cancelled', 'failed', 'expired'))
);
CREATE INDEX "bot_proposals_organization_id_status_idx" ON "bot_proposals"("organization_id", "status");
ALTER TABLE "bot_proposals" ADD CONSTRAINT "bot_proposals_conversation_id_organization_id_fkey" FOREIGN KEY ("conversation_id", "organization_id") REFERENCES "bot_conversations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tokens per organization per month, for the monthly budget.
CREATE TABLE "bot_usage" (
    "organization_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_usage_pkey" PRIMARY KEY ("organization_id", "month")
);
ALTER TABLE "bot_usage" ADD CONSTRAINT "bot_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bot_conversations', 'bot_messages', 'bot_proposals', 'bot_usage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())',
      t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO manorg_app', t);
    END IF;
  END LOOP;
END $$;
