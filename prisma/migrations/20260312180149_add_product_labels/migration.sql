-- AlterTable
ALTER TABLE "products" ADD COLUMN     "is_new" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_popular" BOOLEAN NOT NULL DEFAULT false;
