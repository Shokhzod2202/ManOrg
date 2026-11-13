ALTER TABLE "punch_events" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "punch_events_idempotency" ON "punch_events" ("organization_id", "employee_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
