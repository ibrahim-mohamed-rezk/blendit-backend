-- Delivery queue: only NEW (pending), COMPLETED, CANCELLED — no in-between workflow.
UPDATE "delivery_orders" SET "status" = 'COMPLETED' WHERE "status"::text IN ('ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY');

ALTER TABLE "delivery_orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "delivery_orders" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
DROP TYPE "DeliveryStatus";
CREATE TYPE "DeliveryStatus" AS ENUM ('NEW', 'COMPLETED', 'CANCELLED');
ALTER TABLE "delivery_orders" ALTER COLUMN "status" TYPE "DeliveryStatus" USING "status"::"DeliveryStatus";
ALTER TABLE "delivery_orders" ALTER COLUMN "status" SET DEFAULT 'NEW'::"DeliveryStatus";
