-- Product sizes (e.g. Small / Medium / Large) with per-size pricing
CREATE TABLE "product_sizes" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_sizes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_sizes_product_id_name_key" ON "product_sizes"("product_id", "name");

ALTER TABLE "product_sizes" ADD CONSTRAINT "product_sizes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD COLUMN "product_size_id" INTEGER;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_size_id_fkey" FOREIGN KEY ("product_size_id") REFERENCES "product_sizes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign key for the per-size recipe column added in
-- 20260615160000_product_recipe_per_size. It lives here because
-- "product_sizes" only exists from this migration onward.
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_product_size_id_fkey"
  FOREIGN KEY ("product_size_id") REFERENCES "product_sizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
