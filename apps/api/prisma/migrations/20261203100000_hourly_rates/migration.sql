-- Decided 2026-11-26: owners set each person's hourly cost (add-only history).

-- CreateTable
CREATE TABLE "hourly_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "hourly_rate" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hourly_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hourly_rates_organization_id_employee_id_effective_from_idx" ON "hourly_rates"("organization_id", "employee_id", "effective_from");

-- AddForeignKey
ALTER TABLE "hourly_rates" ADD CONSTRAINT "hourly_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "hourly_rates" ADD CONSTRAINT "hourly_rates_not_negative" CHECK ("hourly_rate" >= 0);
ALTER TABLE "hourly_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hourly_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hourly_rates"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT ON "hourly_rates" TO manorg_app;
  END IF;
END $$;
