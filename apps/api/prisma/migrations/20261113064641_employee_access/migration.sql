-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "employee_access" JSONB NOT NULL DEFAULT '{}';

-- Only JSON objects; the API validates keys and values.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_employee_access_object" CHECK (jsonb_typeof("employee_access") = 'object');
