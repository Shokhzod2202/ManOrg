-- Decided 2026-11-27: ownership can be shared. An owner makes another member an owner too, so an
-- organization may have several owners (always at least one, checked in the members service).
DROP INDEX IF EXISTS "memberships_one_owner_per_org";
