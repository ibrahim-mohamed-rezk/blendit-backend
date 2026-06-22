-- Buy X Get Y offers (branch-scoped)
CREATE TABLE "bogo_offers" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "buy_product_id" INTEGER NOT NULL,
    "buy_quantity" INTEGER NOT NULL DEFAULT 2,
    "get_product_id" INTEGER NOT NULL,
    "get_quantity" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bogo_offers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "bogo_offers" ADD CONSTRAINT "bogo_offers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bogo_offers" ADD CONSTRAINT "bogo_offers_buy_product_id_fkey" FOREIGN KEY ("buy_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bogo_offers" ADD CONSTRAINT "bogo_offers_get_product_id_fkey" FOREIGN KEY ("get_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "bogo_offers_branch_id_idx" ON "bogo_offers"("branch_id");
