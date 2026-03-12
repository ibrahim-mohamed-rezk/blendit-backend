-- CreateTable
CREATE TABLE "held_orders" (
    "id" SERIAL NOT NULL,
    "cashier_id" INTEGER NOT NULL,
    "order_type" TEXT NOT NULL,
    "table_number" TEXT,
    "customer_id" INTEGER,
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "held_orders_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "held_orders" ADD CONSTRAINT "held_orders_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_orders" ADD CONSTRAINT "held_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
