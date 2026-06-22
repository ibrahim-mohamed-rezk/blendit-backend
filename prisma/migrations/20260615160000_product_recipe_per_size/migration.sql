-- Per-size recipe quantities; preserve history via surrogate id
ALTER TABLE "product_recipe_items" ADD COLUMN "id" SERIAL;
ALTER TABLE "product_recipe_items" ADD COLUMN "product_size_id" INTEGER;

ALTER TABLE "product_recipe_items" DROP CONSTRAINT "product_recipe_items_pkey";
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_pkey" PRIMARY KEY ("id");

ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_product_size_id_fkey"
  FOREIGN KEY ("product_size_id") REFERENCES "product_sizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "product_recipe_items_product_inventory_default_size_key"
  ON "product_recipe_items" ("product_id", "inventory_item_id")
  WHERE "product_size_id" IS NULL;

CREATE UNIQUE INDEX "product_recipe_items_product_inventory_size_key"
  ON "product_recipe_items" ("product_id", "inventory_item_id", "product_size_id")
  WHERE "product_size_id" IS NOT NULL;
