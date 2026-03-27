-- CreateTable
CREATE TABLE "loyalty_tiers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "points_threshold" INTEGER NOT NULL,
    "color_from" TEXT NOT NULL DEFAULT '#22c55e',
    "color_to" TEXT NOT NULL DEFAULT '#10b981',
    "benefits" TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id")
);
