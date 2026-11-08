-- CreateEnum
CREATE TYPE "organization_type" AS ENUM ('bakery', 'contractor');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('admin', 'employee');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('pending', 'active', 'rejected', 'removed');

-- CreateEnum
CREATE TYPE "link_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "punch_event_type" AS ENUM ('start', 'pause', 'end');

-- CreateEnum
CREATE TYPE "punch_source" AS ENUM ('self', 'admin');

-- CreateEnum
CREATE TYPE "decision_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "task_type" AS ENUM ('general', 'ingredient_order');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('open', 'done');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('placed', 'cancelled');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('draft', 'completed', 'confirmed', 'change_requested');

-- CreateEnum
CREATE TYPE "ingredient_order_status" AS ENUM ('requested', 'fulfilled', 'checked');

-- CreateEnum
CREATE TYPE "pack_unit" AS ENUM ('g', 'kg', 'pc', 'L', 'mL');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('user', 'bot');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('ios', 'android', 'web');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "organization_type" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "geofence_radius_m" INTEGER NOT NULL DEFAULT 100,
    "punch_tolerance_min" INTEGER NOT NULL DEFAULT 10,
    "order_cutoff_time" TEXT NOT NULL DEFAULT '20:00',
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "status" "membership_status" NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "status" "link_status" NOT NULL,
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punch_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "event_type" "punch_event_type" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "punch_source" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punch_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punch_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "shift_date" DATE NOT NULL,
    "requested_start" TIMESTAMPTZ(3),
    "requested_end" TIMESTAMPTZ(3),
    "reason" TEXT,
    "status" "decision_status" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punch_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "minutes_per_10" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "order_schedule_weekday" SMALLINT,
    "order_schedule_time" TIME(0),
    "pack_price" DECIMAL(12,2),
    "pack_quantity" DECIMAL(12,3) NOT NULL,
    "pack_unit" "pack_unit" NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity_per_10" DECIMAL(12,3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("product_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "employee_products" (
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_products_pkey" PRIMARY KEY ("employee_id","product_id")
);

-- CreateTable
CREATE TABLE "ingredient_assignments" (
    "organization_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_assignments_pkey" PRIMARY KEY ("ingredient_id","employee_id")
);

-- CreateTable
CREATE TABLE "ingredient_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "ordered_by" UUID NOT NULL,
    "packs" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ingredient_order_status" NOT NULL DEFAULT 'requested',
    "task_id" UUID,
    "fulfilled_by" UUID,
    "fulfilled_at" TIMESTAMPTZ(3),
    "checked_by" UUID,
    "checked_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "organization_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","employee_id")
);

-- CreateTable
CREATE TABLE "output_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "team_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "output_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "cleaning_hours" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "assignee_id" UUID,
    "created_by" UUID NOT NULL,
    "task_type" "task_type" NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "status" "task_status" NOT NULL DEFAULT 'open',
    "completed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "taken_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "placed_by" UUID NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "order_status" NOT NULL DEFAULT 'placed',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "order_id" UUID,
    "delivery_date" DATE NOT NULL,
    "window_start" TIMESTAMPTZ(3),
    "window_end" TIMESTAMPTZ(3),
    "status" "delivery_status" NOT NULL DEFAULT 'draft',
    "completed_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "ordered_quantity" INTEGER NOT NULL DEFAULT 0,
    "delivered_quantity" INTEGER NOT NULL,
    "is_unordered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contractor_org_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "status" "decision_status" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "device_platform" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID NOT NULL,
    "on_behalf_of" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "organizations_name_idx" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "memberships_organization_id_status_idx" ON "memberships"("organization_id", "status");

-- CreateIndex
CREATE INDEX "memberships_user_id_status_idx" ON "memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "contractor_links_organization_id_status_idx" ON "contractor_links"("organization_id", "status");

-- CreateIndex
CREATE INDEX "contractor_links_contractor_org_id_status_idx" ON "contractor_links"("contractor_org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_organization_id_employee_id_weekday_key" ON "shifts"("organization_id", "employee_id", "weekday");

-- CreateIndex
CREATE INDEX "punch_events_organization_id_employee_id_occurred_at_idx" ON "punch_events"("organization_id", "employee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "punch_change_requests_organization_id_status_idx" ON "punch_change_requests"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_organization_id_key" ON "products"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_id_organization_id_key" ON "ingredients"("id", "organization_id");

-- CreateIndex
CREATE INDEX "ingredient_orders_organization_id_status_idx" ON "ingredient_orders"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_organization_id_key" ON "teams"("id", "organization_id");

-- CreateIndex
CREATE INDEX "output_entries_organization_id_work_date_idx" ON "output_entries"("organization_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_logs_organization_id_employee_id_work_date_key" ON "daily_logs"("organization_id", "employee_id", "work_date");

-- CreateIndex
CREATE INDEX "tasks_organization_id_assignee_id_status_idx" ON "tasks"("organization_id", "assignee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_organization_id_key" ON "tasks"("id", "organization_id");

-- CreateIndex
CREATE INDEX "orders_organization_id_delivery_date_idx" ON "orders"("organization_id", "delivery_date");

-- CreateIndex
CREATE UNIQUE INDEX "orders_id_organization_id_contractor_org_id_key" ON "orders"("id", "organization_id", "contractor_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_id_organization_id_contractor_org_id_key" ON "deliveries"("id", "organization_id", "contractor_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_organization_id_contractor_org_id_delivery_date_key" ON "deliveries"("organization_id", "contractor_org_id", "delivery_date");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "audit_log_organization_id_at_idx" ON "audit_log"("organization_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_links" ADD CONSTRAINT "contractor_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_links" ADD CONSTRAINT "contractor_links_contractor_org_id_fkey" FOREIGN KEY ("contractor_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punch_change_requests" ADD CONSTRAINT "punch_change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_ingredient_id_organization_id_fkey" FOREIGN KEY ("ingredient_id", "organization_id") REFERENCES "ingredients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_products" ADD CONSTRAINT "employee_products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_products" ADD CONSTRAINT "employee_products_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_assignments" ADD CONSTRAINT "ingredient_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_assignments" ADD CONSTRAINT "ingredient_assignments_ingredient_id_organization_id_fkey" FOREIGN KEY ("ingredient_id", "organization_id") REFERENCES "ingredients"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_orders" ADD CONSTRAINT "ingredient_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_orders" ADD CONSTRAINT "ingredient_orders_ingredient_id_organization_id_fkey" FOREIGN KEY ("ingredient_id", "organization_id") REFERENCES "ingredients"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_orders" ADD CONSTRAINT "ingredient_orders_task_id_organization_id_fkey" FOREIGN KEY ("task_id", "organization_id") REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_organization_id_fkey" FOREIGN KEY ("team_id", "organization_id") REFERENCES "teams"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "output_entries" ADD CONSTRAINT "output_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "output_entries" ADD CONSTRAINT "output_entries_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "output_entries" ADD CONSTRAINT "output_entries_team_id_organization_id_fkey" FOREIGN KEY ("team_id", "organization_id") REFERENCES "teams"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_task_id_organization_id_fkey" FOREIGN KEY ("task_id", "organization_id") REFERENCES "tasks"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_contractor_org_id_fkey" FOREIGN KEY ("contractor_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_organization_id_contractor_org_id_fkey" FOREIGN KEY ("order_id", "organization_id", "contractor_org_id") REFERENCES "orders"("id", "organization_id", "contractor_org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_contractor_org_id_fkey" FOREIGN KEY ("contractor_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_organization_id_contractor_org_id_fkey" FOREIGN KEY ("order_id", "organization_id", "contractor_org_id") REFERENCES "orders"("id", "organization_id", "contractor_org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_organization_id_contractor_org__fkey" FOREIGN KEY ("delivery_id", "organization_id", "contractor_org_id") REFERENCES "deliveries"("id", "organization_id", "contractor_org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_change_requests" ADD CONSTRAINT "delivery_change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_change_requests" ADD CONSTRAINT "delivery_change_requests_delivery_id_organization_id_contr_fkey" FOREIGN KEY ("delivery_id", "organization_id", "contractor_org_id") REFERENCES "deliveries"("id", "organization_id", "contractor_org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- Open question 3 (one organization per user in v1): at most one pending or active membership.
CREATE UNIQUE INDEX "memberships_one_open_per_user" ON "memberships" ("user_id")
  WHERE "status" IN ('pending', 'active');

-- One open link between a bakery and a contractor.
CREATE UNIQUE INDEX "contractor_links_one_open_per_pair" ON "contractor_links" ("organization_id", "contractor_org_id")
  WHERE "status" IN ('pending', 'approved');

-- A contractor has at most one active order per delivery date (spec section 4).
CREATE UNIQUE INDEX "orders_one_active_per_day" ON "orders" ("organization_id", "contractor_org_id", "delivery_date")
  WHERE "status" = 'placed';

-- Output: one personal line per employee, date and product; one team line per team, date and product.
CREATE UNIQUE INDEX "output_entries_personal_unique" ON "output_entries" ("employee_id", "work_date", "product_id")
  WHERE "team_id" IS NULL;
CREATE UNIQUE INDEX "output_entries_team_unique" ON "output_entries" ("team_id", "work_date", "product_id")
  WHERE "team_id" IS NOT NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_order_cutoff_format" CHECK ("order_cutoff_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tolerance_non_negative" CHECK ("punch_tolerance_min" >= 0);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_geofence_positive" CHECK ("geofence_radius_m" > 0);
ALTER TABLE "contractor_links" ADD CONSTRAINT "contractor_links_distinct_orgs" CHECK ("organization_id" <> "contractor_org_id");
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "products" ADD CONSTRAINT "products_minutes_positive" CHECK ("minutes_per_10" > 0);
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_schedule_weekday_range" CHECK ("order_schedule_weekday" IS NULL OR "order_schedule_weekday" BETWEEN 0 AND 6);
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_pack_quantity_positive" CHECK ("pack_quantity" > 0);
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_pack_price_non_negative" CHECK ("pack_price" IS NULL OR "pack_price" >= 0);
ALTER TABLE "ingredient_orders" ADD CONSTRAINT "ingredient_orders_packs_positive" CHECK ("packs" > 0);
ALTER TABLE "output_entries" ADD CONSTRAINT "output_entries_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_cleaning_hours_range" CHECK ("cleaning_hours" >= 0 AND "cleaning_hours" <= 24);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_distinct_orgs" CHECK ("organization_id" <> "contractor_org_id");
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_distinct_orgs" CHECK ("organization_id" <> "contractor_org_id");
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_window_order" CHECK ("window_start" IS NULL OR "window_end" IS NULL OR "window_end" > "window_start");
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_quantities_non_negative" CHECK ("ordered_quantity" >= 0 AND "delivered_quantity" >= 0);
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_type" CHECK ("content_type" IN ('image/jpeg', 'image/png'));
ALTER TABLE "task_photos" ADD CONSTRAINT "task_photos_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760);
