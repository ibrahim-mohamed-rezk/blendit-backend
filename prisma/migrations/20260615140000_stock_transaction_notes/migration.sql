-- Optional notes on manual stock adjustments
ALTER TABLE "stock_transactions" ADD COLUMN "notes" TEXT;

CREATE INDEX "stock_transactions_created_at_idx" ON "stock_transactions"("created_at");
