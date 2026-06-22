-- Optional purchase total (EGP) for restocks — inventory costing only, not product prices.
ALTER TABLE "stock_transactions" ADD COLUMN "total_price" DOUBLE PRECISION;
