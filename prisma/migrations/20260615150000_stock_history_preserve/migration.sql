-- Preserve stock history when inventory items are deleted
ALTER TABLE "stock_transactions" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "stock_transactions" ADD COLUMN "item_name" TEXT;
ALTER TABLE "stock_transactions" ADD COLUMN "item_unit" TEXT;

UPDATE "stock_transactions" st
SET
  "branch_id" = ii."branch_id",
  "item_name" = ii."name",
  "item_unit" = ii."unit"
FROM "inventory_items" ii
WHERE st."inventory_item_id" = ii."id";

UPDATE "stock_transactions"
SET "item_name" = 'Unknown', "item_unit" = 'units'
WHERE "item_name" IS NULL;

DELETE FROM "stock_transactions" WHERE "branch_id" IS NULL;

ALTER TABLE "stock_transactions" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "stock_transactions" ALTER COLUMN "item_name" SET NOT NULL;
ALTER TABLE "stock_transactions" ALTER COLUMN "item_unit" SET NOT NULL;

ALTER TABLE "stock_transactions" DROP CONSTRAINT "stock_transactions_inventory_item_id_fkey";
ALTER TABLE "stock_transactions" ALTER COLUMN "inventory_item_id" DROP NOT NULL;
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "stock_transactions_branch_id_idx" ON "stock_transactions"("branch_id");
