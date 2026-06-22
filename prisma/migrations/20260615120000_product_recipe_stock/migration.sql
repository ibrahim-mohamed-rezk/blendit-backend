-- AlterTable
ALTER TABLE "orders" ADD COLUMN "stock_deducted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "product_recipe_items" (
    "product_id" INTEGER NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "product_recipe_items_pkey" PRIMARY KEY ("product_id","inventory_item_id")
);

-- AlterTable
ALTER TABLE "stock_transactions" ADD COLUMN "order_id" INTEGER;

-- CreateIndex
CREATE INDEX "stock_transactions_order_id_idx" ON "stock_transactions"("order_id");

-- AddForeignKey
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
