import { config } from 'dotenv';
config();

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

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@blendit.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123';
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

    await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        password_hash: passwordHash,
        role_id: superAdminRole.id,
      },
    });
    console.log(`Super Admin created!`);
    console.log(`Email: ${adminEmail} | Password: ${process.env.SEED_ADMIN_PASSWORD ? '(from env)' : adminPassword}`);
  } else {
    console.log('Super Admin already exists.');
  }

  // 3. Create sample Categories
  const categoryNames = ['Smoothies', 'Juices', 'Bowls', 'Add-ons'];
  const categoryIds: Record<string, number> = {};
  for (const catName of categoryNames) {
    const cat = await prisma.category.upsert({
      where: { name: catName },
      update: {},
      create: { name: catName },
    });
    categoryIds[catName] = cat.id;
  }
  console.log('Categories created or verified.');

  // 4. Create sample Products
  const products = [
    { name: 'Tropical Glow', description: 'Mango, pineapple, banana, coconut water', price: 85, category: 'Smoothies' },
    { name: 'Berry Boom', description: 'Blueberries, strawberries, banana, almond milk', price: 95, category: 'Smoothies' },
    { name: 'Green Pulse', description: 'Spinach, kale, green apple, matcha', price: 90, category: 'Smoothies' },
    { name: 'Wake Up Call', description: 'Orange, lemon, grapefruit', price: 70, category: 'Juices' },
    { name: 'Detox Boss', description: 'Kale, celery, green apple, cucumber', price: 78, category: 'Juices' },
    { name: 'Acai Bowl', description: 'Acai, banana, granola, coconut', price: 120, category: 'Bowls' },
    { name: 'Protein Boost', description: 'Add 15g protein to any smoothie', price: 25, category: 'Add-ons' },
  ];
  for (const p of products) {
    const catId = categoryIds[p.category];
    if (!catId) continue;
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    if (!existing) {
      await prisma.product.create({
        data: {
          name: p.name,
          description: p.description,
          price: p.price,
          category_id: catId,
          ingredients: [],
          is_available: true,
        },
      });
    }
  }
  console.log('Products created or verified.');

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
