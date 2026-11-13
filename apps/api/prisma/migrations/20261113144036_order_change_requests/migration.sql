-- CreateEnum
CREATE TYPE "change_item_kind" AS ENUM ('add', 'increase', 'decrease', 'remove');

-- CreateEnum
CREATE TYPE "change_item_status" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateTable
CREATE TABLE "order_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_change_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "from_quantity" INTEGER NOT NULL,
    "to_quantity" INTEGER NOT NULL,
    "kind" "change_item_kind" NOT NULL,
    "status" "change_item_status" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_change_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_change_requests_organization_id_status_idx" ON "order_change_requests"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "order_change_requests_id_organization_id_contractor_org_id_key" ON "order_change_requests"("id", "organization_id", "contractor_org_id");

-- CreateIndex
CREATE INDEX "order_change_items_request_id_idx" ON "order_change_items"("request_id");

-- AddForeignKey
ALTER TABLE "order_change_requests" ADD CONSTRAINT "order_change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_change_requests" ADD CONSTRAINT "order_change_requests_order_id_organization_id_contractor__fkey" FOREIGN KEY ("order_id", "organization_id", "contractor_org_id") REFERENCES "orders"("id", "organization_id", "contractor_org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_change_items" ADD CONSTRAINT "order_change_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_change_items" ADD CONSTRAINT "order_change_items_request_id_organization_id_contractor_o_fkey" FOREIGN KEY ("request_id", "organization_id", "contractor_org_id") REFERENCES "order_change_requests"("id", "organization_id", "contractor_org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Shared by the provider (organization_id) and the contractor (contractor_org_id), like orders.
ALTER TABLE "order_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_change_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "order_change_requests"
  USING (organization_id = app_current_org() OR contractor_org_id = app_current_org())
  WITH CHECK (organization_id = app_current_org() OR contractor_org_id = app_current_org());
ALTER TABLE "order_change_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_change_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "order_change_items"
  USING (organization_id = app_current_org() OR contractor_org_id = app_current_org())
  WITH CHECK (organization_id = app_current_org() OR contractor_org_id = app_current_org());
ALTER TABLE "order_change_items" ADD CONSTRAINT "order_change_items_quantities" CHECK ("from_quantity" >= 0 AND "to_quantity" >= 0 AND "from_quantity" <> "to_quantity");
ALTER TABLE "order_change_requests" ADD CONSTRAINT "order_change_requests_status" CHECK ("status" IN ('open', 'closed'));
