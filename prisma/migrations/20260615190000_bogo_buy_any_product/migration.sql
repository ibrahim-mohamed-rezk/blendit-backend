-- Allow BOGO offers where any menu product counts toward buy quantity
ALTER TABLE "bogo_offers" ALTER COLUMN "buy_product_id" DROP NOT NULL;
