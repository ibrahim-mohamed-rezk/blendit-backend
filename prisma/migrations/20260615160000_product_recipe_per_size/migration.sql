-- Per-size recipe quantities; preserve history via surrogate id
ALTER TABLE "product_recipe_items" ADD COLUMN "id" SERIAL;
ALTER TABLE "product_recipe_items" ADD COLUMN "product_size_id" INTEGER;

ALTER TABLE "product_recipe_items" DROP CONSTRAINT "product_recipe_items_pkey";
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_pkey" PRIMARY KEY ("id");

-- NOTE: the foreign key to "product_sizes" is added in the later
-- 20260616120000_product_sizes migration, because that is where the
-- "product_sizes" table is created. Adding it here would fail on a fresh
-- database (the table does not exist yet -> Postgres 42P01).

CREATE UNIQUE INDEX "product_recipe_items_product_inventory_default_size_key"
  ON "product_recipe_items" ("product_id", "inventory_item_id")
  WHERE "product_size_id" IS NULL;

CREATE UNIQUE INDEX "product_recipe_items_product_inventory_size_key"
  ON "product_recipe_items" ("product_id", "inventory_item_id", "product_size_id")
  WHERE "product_size_id" IS NOT NULL;
