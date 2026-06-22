-- One open shift per cashier per branch (close stray duplicates first).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY branch_id, cashier_id
      ORDER BY started_at ASC, id ASC
    ) AS rn
  FROM "shifts"
  WHERE "ended_at" IS NULL
)
UPDATE "shifts" AS s
SET
  "ended_at" = NOW(),
  "total_orders" = 0,
  "completed_orders" = 0,
  "cancelled_orders" = 0,
  "refunded_orders" = 0,
  "gross_sales" = 0,
  "refunds" = 0,
  "net_collected" = 0,
  "payment_totals" = '{"cash":0,"card":0,"wallet":0}'::jsonb
FROM ranked AS r
WHERE s.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "shifts_one_open_per_cashier_branch"
ON "shifts" ("branch_id", "cashier_id")
WHERE "ended_at" IS NULL;
