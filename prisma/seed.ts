import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create Roles
  const roles = ['SUPER_ADMIN', 'ADMIN', 'CASHIER'];
  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }
  console.log('Roles created or verified.');

  // 2. Create Super Admin User
  const superAdminRole = await prisma.role.findUnique({
    where: { name: 'SUPER_ADMIN' },
  });

  if (!superAdminRole) {
    throw new Error('SUPER_ADMIN role not found');
  }

  const adminEmail = 'admin@blendit.com';
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash('Admin@123', saltRounds);

    await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        password_hash: passwordHash,
        role_id: superAdminRole.id,
      },
    });
    console.log(`Super Admin created!`);
    console.log(`Email: ${adminEmail} | Password: Admin@123`);
  } else {
    console.log('Super Admin already exists.');
  }

  // 3. Create sample Categories
  const categories = ['Smoothies', 'Juices', 'Bowls', 'Add-ons'];
  for (const catName of categories) {
    await prisma.category.upsert({
      where: { name: catName },
      update: {},
      create: { name: catName },
    });
  }
  console.log('Categories created or verified.');

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
