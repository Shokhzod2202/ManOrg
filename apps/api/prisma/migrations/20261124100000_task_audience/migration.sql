-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "for_all" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "task_assignees" (
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id","employee_id")
);

-- CreateIndex
CREATE INDEX "task_assignees_organization_id_employee_id_idx" ON "task_assignees"("organization_id", "employee_id");

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_organization_id_fkey" FOREIGN KEY ("task_id", "organization_id") REFERENCES "tasks"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Decided 2026-11-24: tasks for several people or for everyone. Same tenant isolation as tasks.
ALTER TABLE "task_assignees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_assignees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task_assignees"
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "task_assignees" TO manorg_app;
  END IF;
END $$;
