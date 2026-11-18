-- Phase 3: recurring tasks.

-- CreateEnum
CREATE TYPE "recurrence_frequency" AS ENUM ('daily', 'weekly', 'monthly');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "occurrence_date" DATE,
ADD COLUMN     "recurring_task_id" UUID;

-- CreateTable
CREATE TABLE "recurring_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "assignee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "frequency" "recurrence_frequency" NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "day_of_month" INTEGER,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_tasks_organization_id_active_idx" ON "recurring_tasks"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_recurring_task_id_occurrence_date_key" ON "tasks"("recurring_task_id", "occurrence_date");


ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recurring_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recurring_tasks"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "recurring_tasks" TO manorg_app;
  END IF;
END $$;
