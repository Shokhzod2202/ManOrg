-- Decided 2026-11-26. Each organization has one owner: an admin with power over the other admins.
-- Admins do not work shifts unless switched on (punch card, shift lists, hours).
ALTER TABLE "memberships" ADD COLUMN "owner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "works_shifts" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "memberships_one_owner_per_org" ON "memberships" ("organization_id")
  WHERE "owner" AND "status" = 'active';
