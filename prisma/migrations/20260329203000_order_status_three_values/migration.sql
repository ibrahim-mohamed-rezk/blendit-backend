-- Collapse order lifecycle to PENDING (website only), COMPLETED, CANCELLED (incl. refunds).
UPDATE "orders" SET "status" = 'CANCELLED' WHERE "status"::text = 'REFUNDED';
UPDATE "orders" SET "status" = 'PENDING' WHERE "status"::text IN ('PREPARING', 'READY');

ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
DROP TYPE "OrderStatus";
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::"OrderStatus");
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"OrderStatus";
