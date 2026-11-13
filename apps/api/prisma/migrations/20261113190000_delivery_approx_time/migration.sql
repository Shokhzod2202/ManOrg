-- DTM-1: the approximate delivery time is saved on the contractor link.
ALTER TABLE "contractor_links" ADD COLUMN "approx_start" TIME(0);
ALTER TABLE "contractor_links" ADD COLUMN "approx_end" TIME(0);
ALTER TABLE "contractor_links" ADD CONSTRAINT "contractor_links_approx_order" CHECK (
  ("approx_start" IS NULL AND "approx_end" IS NULL) OR ("approx_start" IS NOT NULL AND "approx_end" IS NOT NULL AND "approx_end" > "approx_start")
);
