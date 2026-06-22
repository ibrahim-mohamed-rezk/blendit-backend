/**
 * Force-create / reset the super-admin login.
 *
 * Unlike the seed (which never touches an existing admin), this script always
 * sets the password, marks the user active, and gives it the SUPER_ADMIN role
 * on the main branch. Use it when you are locked out.
 *
 * Run from blendit-backend/ (uses DATABASE_URL from .env):
 *   npx ts-node prisma/reset-admin.ts
 *   RESET_ADMIN_EMAIL=me@x.com RESET_ADMIN_PASSWORD='Secret123' npx ts-node prisma/reset-admin.ts
 */
import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.RESET_ADMIN_EMAIL ?? 'admin@blendit.com';
  const password = process.env.RESET_ADMIN_PASSWORD ?? 'Admin@123';

  const role = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: { name: 'SUPER_ADMIN' },
  });

  const branch = await prisma.branch.upsert({
    where: { slug: 'main' },
    update: {},
    create: { name: 'Main', slug: 'main', delivery_address_prefix: 'District 5, ' },
  });

  const password_hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { password_hash, is_active: true, role_id: role.id },
    create: {
      name: 'Super Admin',
      email,
      password_hash,
      role_id: role.id,
      branch_id: branch.id,
      is_active: true,
    },
  });

  await prisma.userBranch.upsert({
    where: { user_id_branch_id: { user_id: user.id, branch_id: branch.id } },
    update: {},
    create: { user_id: user.id, branch_id: branch.id },
  });

  // Show every admin-capable account so it is obvious which emails exist.
  const admins = await prisma.user.findMany({
    where: { role: { name: { in: ['SUPER_ADMIN', 'ADMIN'] } } },
    select: { id: true, email: true, is_active: true, role: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });

  console.log(`\n✅ Admin login reset for: ${email}`);
  console.log(`   Password set to: ${password}`);
  console.log(`\nExisting admin/super-admin accounts in this database:`);
  for (const a of admins) {
    console.log(`   - ${a.email}  [${a.role.name}]  active=${a.is_active}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
