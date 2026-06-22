-- Canceled orders: payment rows should be refunded with negative amounts for the Transactions ledger.
UPDATE "transactions" AS t
SET
  "status" = 'REFUNDED',
  "amount" = -ABS(t."amount")
FROM "orders" AS o
WHERE t."order_id" = o."id"
  AND o."status" = 'CANCELLED'
  AND t."status" = 'COMPLETED';

-- Legacy refunded rows that still store a positive amount.
UPDATE "transactions"
SET "amount" = -ABS("amount")
WHERE "status" = 'REFUNDED'
  AND "amount" > 0;
