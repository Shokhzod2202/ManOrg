-- Decided 2026-11-30: undo for making an owner, and salary advances (avans).

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "owner_granted_at" TIMESTAMPTZ(3),
ADD COLUMN     "owner_granted_by" UUID,
ADD COLUMN     "owner_previous_role" "membership_role";

-- CreateTable
CREATE TABLE "salary_advances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_on" DATE NOT NULL,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_advances_organization_id_paid_on_idx" ON "salary_advances"("organization_id", "paid_on");

-- CreateIndex
CREATE INDEX "salary_advances_organization_id_employee_id_paid_on_idx" ON "salary_advances"("organization_id", "employee_id", "paid_on");

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "salary_advances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salary_advances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "salary_advances"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "salary_advances" TO manorg_app;
  END IF;
END $$;
