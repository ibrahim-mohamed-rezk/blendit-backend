-- Distinguish POS vs website orders for delivery→sale status sync (POS delivery: accept → sale completed).
CREATE TYPE "OrderChannel" AS ENUM ('POS', 'WEBSITE');
ALTER TABLE "orders" ADD COLUMN "channel" "OrderChannel";
