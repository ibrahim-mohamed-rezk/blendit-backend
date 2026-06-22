# Multi-branch rollout

## Pre-deploy

1. Backup production database:
   ```bash
   pg_dump "$DATABASE_URL" -Fc -f blendit_pre_branches.dump
   ```

2. Review migration: `prisma/migrations/20260519120000_add_branches/migration.sql`

## Deploy

1. Apply migration:
   ```bash
   cd blendit-backend
   npx prisma migrate deploy
   npx prisma generate
   ```

2. Run spot-checks:
   ```bash
   psql "$DATABASE_URL" -f scripts/verify-branches-migration.sql
   ```

3. Deploy backend, then POS/admin frontend, then website.

4. Seed (optional on fresh env):
   ```bash
   npx prisma db seed
   ```

## Post-deploy

- Super admin: create branches via `POST /branches`, assign admins via Employees UI.
- Copy products to new branches via Admin → Products → Copy to branch (super admin).
- Cashiers: set home `branch_id` on user record.

## Verification checklist

- [ ] Cashier at branch A cannot read branch B order (404)
- [ ] Customer earns loyalty at branch A, redeems at branch B
- [ ] Website: pick branch → menu matches branch → order appears only on that branch POS
- [ ] Realtime: order at branch A does not appear on branch B POS
