-- Per-branch admin page permissions
ALTER TABLE "user_branches" ADD COLUMN "page_access" JSONB;
