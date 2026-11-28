-- Decided 2026-11-28: how much of each pack is thrown away (peel, trimmings).

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "waste_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0;

ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_waste_not_negative" CHECK ("waste_quantity" >= 0);
