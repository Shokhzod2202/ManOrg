-- F-001 delivery-based financial tracking (approved 2026-11-12), built in phase 3.

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'reversed');

-- CreateEnum
CREATE TYPE "settlement_kind" AS ENUM ('mid_month', 'month_end', 'custom');

-- CreateEnum
CREATE TYPE "period_status" AS ENUM ('open', 'closed');

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "total_value" INTEGER;

-- AlterTable
ALTER TABLE "delivery_lines" ADD COLUMN     "line_value" INTEGER,
ADD COLUMN     "unit_price" INTEGER;

-- CreateTable
CREATE TABLE "product_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "submitted_by" UUID NOT NULL,
    "submitted_amount" INTEGER NOT NULL,
    "note" TEXT,
    "proof_key" TEXT NOT NULL,
    "proof_type" TEXT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "approved_amount" INTEGER,
    "payment_date" DATE,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "reversed_reason" TEXT,
    "reversed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "kind" "settlement_kind" NOT NULL,
    "status" "period_status" NOT NULL DEFAULT 'open',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "opening_balance" INTEGER NOT NULL,
    "delivered_value" INTEGER NOT NULL,
    "approved_payments" INTEGER NOT NULL,
    "adjustments" INTEGER NOT NULL,
    "closing_balance" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "closed_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "delivery_id" UUID,
    "payment_id" UUID,
    "effective_date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_prices_product_id_effective_from_idx" ON "product_prices"("product_id", "effective_from");

-- CreateIndex
CREATE INDEX "payments_organization_id_contractor_org_id_status_idx" ON "payments"("organization_id", "contractor_org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_organization_id_contractor_org_id_key" ON "payments"("id", "organization_id", "contractor_org_id");

-- CreateIndex
CREATE INDEX "payment_allocations_delivery_id_idx" ON "payment_allocations"("delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_periods_id_organization_id_contractor_org_id_key" ON "settlement_periods"("id", "organization_id", "contractor_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_periods_organization_id_contractor_org_id_start__key" ON "settlement_periods"("organization_id", "contractor_org_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_reports_period_id_key" ON "settlement_reports"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_reports_period_id_organization_id_contractor_org_key" ON "settlement_reports"("period_id", "organization_id", "contractor_org_id");

-- CreateIndex
CREATE INDEX "balance_adjustments_organization_id_contractor_org_id_effec_idx" ON "balance_adjustments"("organization_id", "contractor_org_id", "effective_date");

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_organization_id_contractor__fkey" FOREIGN KEY ("payment_id", "organization_id", "contractor_org_id") REFERENCES "payments"("id", "organization_id", "contractor_org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_reports" ADD CONSTRAINT "settlement_reports_period_id_organization_id_contractor_or_fkey" FOREIGN KEY ("period_id", "organization_id", "contractor_org_id") REFERENCES "settlement_periods"("id", "organization_id", "contractor_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security. Product prices belong to the bakery; money records are shared by the bakery
-- (organization_id) and the contractor (contractor_org_id), like orders and deliveries.
ALTER TABLE "product_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_prices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_prices"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payments', 'payment_allocations', 'settlement_periods', 'settlement_reports', 'balance_adjustments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (organization_id = app_current_org() OR contractor_org_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org() OR contractor_org_id = app_current_org())',
      t);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "product_prices", "payments", "payment_allocations",
      "settlement_periods", "balance_adjustments" TO manorg_app;
    -- A closed report is a snapshot that is never changed (F-001 rule 8).
    REVOKE UPDATE, DELETE ON "settlement_reports" FROM manorg_app;
    GRANT SELECT, INSERT ON "settlement_reports" TO manorg_app;
    -- Prices are history: a new price is a new row.
    REVOKE UPDATE, DELETE ON "product_prices" FROM manorg_app;
  END IF;
END $$;
