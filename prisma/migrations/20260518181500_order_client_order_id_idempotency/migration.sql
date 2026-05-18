ALTER TABLE "orders"
ADD COLUMN "client_order_id" TEXT;

CREATE UNIQUE INDEX "orders_client_order_id_key"
ON "orders"("client_order_id");
