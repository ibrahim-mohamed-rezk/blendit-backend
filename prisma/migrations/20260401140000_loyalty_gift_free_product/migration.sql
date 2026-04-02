-- AlterTable
ALTER TABLE "loyalty_gifts" ADD COLUMN "gift_product_id" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "loyalty_free_product_id" INTEGER;

-- AddForeignKey
ALTER TABLE "loyalty_gifts" ADD CONSTRAINT "loyalty_gifts_gift_product_id_fkey" FOREIGN KEY ("gift_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_loyalty_free_product_id_fkey" FOREIGN KEY ("loyalty_free_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
