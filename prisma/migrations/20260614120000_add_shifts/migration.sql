-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "cashier_id" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "completed_orders" INTEGER NOT NULL DEFAULT 0,
    "cancelled_orders" INTEGER NOT NULL DEFAULT 0,
    "refunded_orders" INTEGER NOT NULL DEFAULT 0,
    "gross_sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refunds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_collected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payment_totals" JSONB,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_branch_id_started_at_idx" ON "shifts"("branch_id", "started_at");

-- CreateIndex
CREATE INDEX "shifts_cashier_id_ended_at_idx" ON "shifts"("cashier_id", "ended_at");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
