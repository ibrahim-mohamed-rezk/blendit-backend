-- AlterTable (IF NOT EXISTS: safe if applied manually or retried)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "notes" TEXT;
