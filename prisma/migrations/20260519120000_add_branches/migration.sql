-- Multi-branch architecture: create branches, backfill, composite uniques

-- 1. Branches
CREATE TABLE "branches" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "delivery_address_prefix" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_slug_key" ON "branches"("slug");

INSERT INTO "branches" ("name", "slug", "address", "delivery_address_prefix", "updated_at")
VALUES ('Main', 'main', NULL, 'District 5, ', CURRENT_TIMESTAMP);

-- 2. User branches junction
CREATE TABLE "user_branches" (
    "user_id" INTEGER NOT NULL,
    "branch_id" INTEGER NOT NULL,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("user_id","branch_id")
);

ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. User home branch (nullable)
ALTER TABLE "users" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Add nullable branch_id to scoped tables
ALTER TABLE "categories" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "products" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "orders" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "delivery_orders" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "held_orders" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "addons" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "promotions" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "loyalty_gifts" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "inventory_items" ADD COLUMN "branch_id" INTEGER;
ALTER TABLE "activity_logs" ADD COLUMN "branch_id" INTEGER;

-- 5. Backfill to Main branch
UPDATE "categories" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);
UPDATE "products" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);
UPDATE "orders" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);
UPDATE "delivery_orders" d SET "branch_id" = o."branch_id"
FROM "orders" o WHERE d."order_id" = o."id";
UPDATE "held_orders" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);
UPDATE "addons" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);
UPDATE "promotions" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);
UPDATE "loyalty_gifts" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);
UPDATE "inventory_items" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);
UPDATE "activity_logs" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1);

-- 6. Migrate settings to composite PK (branch_id, key)
CREATE TABLE "settings_new" (
    "branch_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_new_pkey" PRIMARY KEY ("branch_id","key")
);

INSERT INTO "settings_new" ("branch_id", "key", "value", "updated_at")
SELECT (SELECT "id" FROM "branches" WHERE "slug" = 'main' LIMIT 1), "key", "value", "updated_at"
FROM "settings";

DROP TABLE "settings";
ALTER TABLE "settings_new" RENAME TO "settings";
ALTER TABLE "settings" ADD CONSTRAINT "settings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Drop old uniques, add composite uniques
DROP INDEX IF EXISTS "categories_name_key";
DROP INDEX IF EXISTS "orders_order_number_key";
DROP INDEX IF EXISTS "orders_client_order_id_key";
DROP INDEX IF EXISTS "inventory_items_name_key";
DROP INDEX IF EXISTS "promotions_code_key";

CREATE UNIQUE INDEX "categories_branch_id_name_key" ON "categories"("branch_id", "name");
CREATE UNIQUE INDEX "orders_branch_id_order_number_key" ON "orders"("branch_id", "order_number");
CREATE UNIQUE INDEX "orders_branch_id_client_order_id_key" ON "orders"("branch_id", "client_order_id");
CREATE UNIQUE INDEX "inventory_items_branch_id_name_key" ON "inventory_items"("branch_id", "name");
CREATE UNIQUE INDEX "promotions_branch_id_code_key" ON "promotions"("branch_id", "code");

-- 8. Foreign keys for branch_id
ALTER TABLE "categories" ADD CONSTRAINT "categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "held_orders" ADD CONSTRAINT "held_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "addons" ADD CONSTRAINT "addons_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loyalty_gifts" ADD CONSTRAINT "loyalty_gifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9. NOT NULL (activity_logs.branch_id stays nullable)
ALTER TABLE "categories" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "delivery_orders" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "held_orders" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "addons" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "promotions" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "loyalty_gifts" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "inventory_items" ALTER COLUMN "branch_id" SET NOT NULL;

-- 10. Attach super admins to all branches via empty user_branches = all (no rows needed)
