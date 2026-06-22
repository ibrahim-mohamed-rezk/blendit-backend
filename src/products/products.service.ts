import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { BranchScope } from '../common/branch-scope';
import { orderBranchWhere } from '../common/branch-scope';
import { CreateProductDto, ProductRecipeItemDto, ProductSizeDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const productInclude = {
  category: true,
  recipeItems: {
    include: {
      inventoryItem: { select: { id: true, name: true, unit: true, quantity: true } },
      productSize: { select: { id: true, name: true } },
    },
    orderBy: [{ inventory_item_id: 'asc' as const }, { product_size_id: 'asc' as const }],
  },
  sizes: {
    where: { is_active: true },
    orderBy: [{ sort_order: 'asc' as const }, { id: 'asc' as const }],
  },
};

type ProductForClone = Prisma.ProductGetPayload<{
  include: {
    sizes: true;
    recipeItems: { include: { inventoryItem: true; productSize: true } };
  };
}>;

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  private async validateRecipeItems(recipeItems: ProductRecipeItemDto[] | undefined, branchId: number) {
    if (!recipeItems?.length) {
      return [];
    }
    const ids = [...new Set(recipeItems.map((r) => r.inventory_item_id))];
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids }, branch_id: branchId },
    });
    if (items.length !== ids.length) {
      throw new BadRequestException('All recipe ingredients must exist in this branch stock');
    }
    return items;
  }

  private ingredientLabelsFromRecipe(
    recipeItems: ProductRecipeItemDto[],
    inventoryItems: { id: number; name: string }[],
  ): string[] {
    const nameById = new Map(inventoryItems.map((i) => [i.id, i.name]));
    const seen = new Set<number>();
    const labels: string[] = [];
    for (const r of recipeItems) {
      if (seen.has(r.inventory_item_id)) continue;
      seen.add(r.inventory_item_id);
      labels.push(nameById.get(r.inventory_item_id) ?? `Item #${r.inventory_item_id}`);
    }
    return labels;
  }

  private buildRecipeCreates(
    productId: number,
    recipeItems: ProductRecipeItemDto[],
    sizeIdByName: Map<string, number>,
  ) {
    const activeSizeNames = [...sizeIdByName.keys()];
    const hasSizes = activeSizeNames.length > 0;

    if (!hasSizes) {
      if (recipeItems.some((r) => r.product_size_id != null || r.size_name?.trim())) {
        throw new BadRequestException('Recipe must not include sizes when the product has no sizes');
      }
      const ids = recipeItems.map((r) => r.inventory_item_id);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException('Duplicate stock ingredients in recipe');
      }
      return recipeItems.map((r) => ({
        product_id: productId,
        inventory_item_id: r.inventory_item_id,
        product_size_id: null,
        quantity: r.quantity,
      }));
    }

    const byIngredient = new Map<number, ProductRecipeItemDto[]>();
    for (const r of recipeItems) {
      const rows = byIngredient.get(r.inventory_item_id) ?? [];
      rows.push(r);
      byIngredient.set(r.inventory_item_id, rows);
    }

    const creates: {
      product_id: number;
      inventory_item_id: number;
      product_size_id: number;
      quantity: number;
    }[] = [];

    for (const [ingredientId, rows] of byIngredient.entries()) {
      for (const sizeName of activeSizeNames) {
        const sizeId = sizeIdByName.get(sizeName)!;
        const row = rows.find(
          (r) =>
            r.product_size_id === sizeId ||
            r.size_name?.trim().toLowerCase() === sizeName.toLowerCase(),
        );
        if (!row || !Number.isFinite(row.quantity) || row.quantity <= 0) {
          const inv = rows[0];
          throw new BadRequestException(
            `Each ingredient needs a quantity for every size (missing "${sizeName}" for ingredient #${ingredientId})`,
          );
        }
        creates.push({
          product_id: productId,
          inventory_item_id: ingredientId,
          product_size_id: sizeId,
          quantity: row.quantity,
        });
      }
      if (rows.length > activeSizeNames.length) {
        throw new BadRequestException(`Duplicate size entries for ingredient #${ingredientId}`);
      }
    }

    return creates;
  }

  private sizeIdMapFromRows(
    sizes: { id: number; name: string }[],
  ): Map<string, number> {
    return new Map(sizes.map((s) => [s.name.trim().toLowerCase(), s.id]));
  }

  private validateSizes(sizes: ProductSizeDto[] | undefined) {
    if (!sizes?.length) return;
    const names = sizes.map((s) => s.name.trim().toLowerCase());
    if (names.some((n) => !n)) {
      throw new BadRequestException('Each size needs a name');
    }
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Duplicate size names');
    }
  }

  private listPriceFromSizes(sizes: ProductSizeDto[] | undefined, fallback: number): number {
    const active = (sizes ?? []).filter((s) => s.is_active !== false);
    if (active.length === 0) return fallback;
    return Math.min(...active.map((s) => s.price));
  }

  private async replaceProductSizes(productId: number, sizes: ProductSizeDto[] | undefined) {
    await this.prisma.productSize.deleteMany({ where: { product_id: productId } });
    if (!sizes?.length) return;
    await this.prisma.productSize.createMany({
      data: sizes.map((s, index) => ({
        product_id: productId,
        name: s.name.trim(),
        price: s.price,
        sort_order: s.sort_order ?? index,
        is_active: s.is_active ?? true,
      })),
    });
  }

  async createCategory(dto: CreateCategoryDto, branchId: number) {
    const exists = await this.prisma.category.findUnique({
      where: { branch_id_name: { branch_id: branchId, name: dto.name } },
    });
    if (exists) throw new BadRequestException('Category already exists');
    return this.prisma.category.create({ data: { name: dto.name, branch_id: branchId } });
  }

  async findAllCategories(scope: BranchScope) {
    return this.prisma.category.findMany({
      where: orderBranchWhere(scope),
      orderBy: { updated_at: 'desc' },
      ...(scope.allBranches
        ? { include: { branch: { select: { id: true, name: true, slug: true } } } }
        : {}),
    });
  }

  async findOneCategory(id: number, branchId: number) {
    const cat = await this.prisma.category.findFirst({ where: { id, branch_id: branchId } });
    if (!cat) throw new NotFoundException(`Category #${id} not found`);
    return cat;
  }

  async updateCategory(id: number, dto: UpdateCategoryDto, branchId: number) {
    await this.findOneCategory(id, branchId);
    const exists = await this.prisma.category.findFirst({
      where: { branch_id: branchId, name: dto.name, NOT: { id } },
    });
    if (exists) throw new BadRequestException('Category with this name already exists');
    return this.prisma.category.update({ where: { id }, data: { name: dto.name } });
  }

  async removeCategory(id: number, branchId: number) {
    await this.findOneCategory(id, branchId);
    await this.prisma.category.delete({ where: { id } });
    return { message: `Category #${id} deleted` };
  }

  async transferCategory(categoryId: number, fromBranchId: number, toBranchId: number) {
    if (fromBranchId === toBranchId) {
      throw new BadRequestException('Source and destination branch must differ');
    }
    const category = await this.findOneCategory(categoryId, fromBranchId);
    const targetBranch = await this.prisma.branch.findUnique({ where: { id: toBranchId } });
    if (!targetBranch?.is_active) throw new NotFoundException('Target branch not found');

    const existing = await this.prisma.category.findFirst({
      where: { branch_id: toBranchId, name: category.name },
    });
    if (existing) {
      throw new BadRequestException(`Category "${category.name}" already exists in target branch`);
    }

    return this.prisma.category.create({
      data: { name: category.name, branch_id: toBranchId },
    });
  }

  /** Copy every category from one branch to another. Categories already present (by name) are skipped. */
  async copyAllCategories(fromBranchId: number, toBranchId: number) {
    if (fromBranchId === toBranchId) {
      throw new BadRequestException('Source and destination branch must differ');
    }
    const targetBranch = await this.prisma.branch.findUnique({ where: { id: toBranchId } });
    if (!targetBranch?.is_active) throw new NotFoundException('Target branch not found');

    const categories = await this.prisma.category.findMany({ where: { branch_id: fromBranchId } });
    const existing = await this.prisma.category.findMany({
      where: { branch_id: toBranchId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));

    let copied = 0;
    let skipped = 0;
    for (const cat of categories) {
      const key = cat.name.trim().toLowerCase();
      if (existingNames.has(key)) {
        skipped++;
        continue;
      }
      await this.prisma.category.create({ data: { name: cat.name, branch_id: toBranchId } });
      existingNames.add(key);
      copied++;
    }

    return {
      message: `Copied ${copied} categor${copied === 1 ? 'y' : 'ies'}, skipped ${skipped} already present`,
      copied,
      skipped,
      total: categories.length,
    };
  }

  async create(dto: CreateProductDto, branchId: number) {
    const category = await this.prisma.category.findFirst({
      where: { id: dto.category_id, branch_id: branchId },
    });
    if (!category) throw new BadRequestException('Category not found in this branch');

    const stockItems = await this.validateRecipeItems(dto.recipe_items, branchId);
    this.validateSizes(dto.sizes);
    const ingredientLabels =
      dto.ingredients?.length && dto.ingredients.length > 0
        ? dto.ingredients
        : this.ingredientLabelsFromRecipe(dto.recipe_items ?? [], stockItems);

    const listPrice = this.listPriceFromSizes(dto.sizes, dto.price);

    const data: Record<string, unknown> = {
      name: dto.name,
      description: dto.description ?? null,
      tagline: dto.tagline ?? null,
      color: dto.color ?? null,
      price: listPrice,
      category_id: dto.category_id,
      branch_id: branchId,
      ingredients: ingredientLabels,
      image_url: dto.image_url ?? null,
      is_available: dto.is_available ?? true,
      is_popular: dto.is_popular ?? false,
      is_new: dto.is_new ?? false,
    };
    if (dto.customization_options !== undefined && dto.customization_options !== null) {
      data.customization_options = Array.isArray(dto.customization_options)
        ? dto.customization_options
        : null;
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...(data as Parameters<typeof tx.product.create>[0]['data']),
          ...(dto.sizes?.length
            ? {
                sizes: {
                  create: dto.sizes.map((s, index) => ({
                    name: s.name.trim(),
                    price: s.price,
                    sort_order: s.sort_order ?? index,
                    is_active: s.is_active ?? true,
                  })),
                },
              }
            : {}),
        },
        include: { sizes: { where: { is_active: true } } },
      });

      const sizeIdByName = this.sizeIdMapFromRows(product.sizes);
      const recipeCreates = this.buildRecipeCreates(product.id, dto.recipe_items ?? [], sizeIdByName);
      if (recipeCreates.length > 0) {
        await tx.productRecipeItem.createMany({ data: recipeCreates });
      }

      const full = await tx.product.findUnique({
        where: { id: product.id },
        include: productInclude,
      });
      if (!full) throw new NotFoundException('Product not found after create');
      return full;
    });
  }

  async findAll(
    scope: BranchScope,
    page = 1,
    limit = 10,
    categoryId?: number,
    available?: boolean,
    search?: string,
    updatedAfter?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { ...orderBranchWhere(scope) };
    if (categoryId) where.category_id = categoryId;
    if (available !== undefined) where.is_available = available;
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { description: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }
    if (updatedAfter?.trim()) {
      const date = new Date(updatedAfter);
      if (!Number.isNaN(date.getTime())) {
        where.updated_at = { gte: date };
      }
    }

    const include = scope.allBranches
      ? {
          ...productInclude,
          branch: { select: { id: true, name: true, slug: true } },
        }
      : productInclude;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        include,
        orderBy: scope.allBranches
          ? [{ branch_id: 'asc' }, { updated_at: 'desc' }]
          : { updated_at: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number, branchId?: number) {
    const where: { id: number; branch_id?: number } = { id };
    if (branchId != null) where.branch_id = branchId;
    const product = await this.prisma.product.findFirst({
      where,
      include: productInclude,
    });
    if (!product) throw new NotFoundException(`Product #${id} not found`);
    return product;
  }

  async update(id: number, dto: UpdateProductDto, branchId: number) {
    await this.findOne(id, branchId);
    const data: Record<string, unknown> = { ...dto };
    delete data.recipe_items;
    delete data.sizes;

    this.validateSizes(dto.sizes);

    if (dto.sizes?.length) {
      data.price = this.listPriceFromSizes(dto.sizes, dto.price ?? (data.price as number) ?? 0);
    }

    if (dto.category_id != null) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.category_id, branch_id: branchId },
      });
      if (!category) throw new BadRequestException('Category not found in this branch');
    }
    if (dto.customization_options !== undefined) {
      data.customization_options = Array.isArray(dto.customization_options)
        ? dto.customization_options
        : null;
    }

    if (dto.recipe_items?.length) {
      const stockItems = await this.validateRecipeItems(dto.recipe_items, branchId);
      data.ingredients =
        dto.ingredients?.length && dto.ingredients.length > 0
          ? dto.ingredients
          : this.ingredientLabelsFromRecipe(dto.recipe_items, stockItems);

      return this.prisma.$transaction(async (tx) => {
        if (dto.sizes !== undefined) {
          await tx.productSize.deleteMany({ where: { product_id: id } });
          if (dto.sizes.length > 0) {
            await tx.productSize.createMany({
              data: dto.sizes.map((s, index) => ({
                product_id: id,
                name: s.name.trim(),
                price: s.price,
                sort_order: s.sort_order ?? index,
                is_active: s.is_active ?? true,
              })),
            });
          }
        }

        const sizes = await tx.productSize.findMany({
          where: { product_id: id, is_active: true },
          orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        });
        const sizeIdByName = this.sizeIdMapFromRows(sizes);

        await tx.productRecipeItem.deleteMany({ where: { product_id: id } });
        const recipeCreates = this.buildRecipeCreates(id, dto.recipe_items!, sizeIdByName);
        if (recipeCreates.length > 0) {
          await tx.productRecipeItem.createMany({ data: recipeCreates });
        }

        return tx.product.update({
          where: { id },
          data: data as Parameters<typeof tx.product.update>[0]['data'],
          include: productInclude,
        });
      });
    }

    if (dto.sizes !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        // Only delete size-scoped recipe items; product-level ones (product_size_id = null) are preserved.
        await tx.productRecipeItem.deleteMany({ where: { product_id: id, product_size_id: { not: null } } });
        await tx.productSize.deleteMany({ where: { product_id: id } });
        if (dto.sizes!.length > 0) {
          await tx.productSize.createMany({
            data: dto.sizes!.map((s, index) => ({
              product_id: id,
              name: s.name.trim(),
              price: s.price,
              sort_order: s.sort_order ?? index,
              is_active: s.is_active ?? true,
            })),
          });
        }
        return tx.product.update({
          where: { id },
          data: data as Parameters<typeof tx.product.update>[0]['data'],
          include: productInclude,
        });
      });
    }

    return this.prisma.product.update({
      where: { id },
      data: data as Parameters<typeof this.prisma.product.update>[0]['data'],
      include: productInclude,
    });
  }

  async remove(id: number, branchId: number) {
    await this.findOne(id, branchId);
    const usedInOrders = await this.prisma.orderItem.count({ where: { product_id: id } });
    if (usedInOrders > 0) {
      throw new BadRequestException(
        `Cannot delete product: it is used in ${usedInOrders} order item(s). Remove or complete those orders first.`,
      );
    }
    await this.prisma.product.delete({ where: { id } });
    return { message: `Product #${id} deleted` };
  }

  /** Find a category by name in a branch, creating it when missing. */
  private async ensureCategory(toBranchId: number, name: string) {
    const found = await this.prisma.category.findFirst({
      where: { branch_id: toBranchId, name },
    });
    if (found) return found;
    return this.prisma.category.create({ data: { name, branch_id: toBranchId } });
  }

  /** Find a stock item by name in a branch, creating an empty one when missing. */
  private async ensureInventoryItem(
    toBranchId: number,
    sourceItem: { name: string; unit: string },
  ) {
    const found = await this.prisma.inventoryItem.findFirst({
      where: { branch_id: toBranchId, name: sourceItem.name },
    });
    if (found) return found;
    return this.prisma.inventoryItem.create({
      data: { branch_id: toBranchId, name: sourceItem.name, unit: sourceItem.unit, quantity: 0 },
    });
  }

  /** Clone a fully-loaded product (sizes + recipe) into a target branch under the given category. */
  private async cloneProductIntoBranch(
    product: ProductForClone,
    toBranchId: number,
    categoryId: number,
  ) {
    const created = await this.prisma.product.create({
      data: {
        name: product.name,
        description: product.description,
        tagline: product.tagline,
        color: product.color,
        price: product.price,
        ingredients: product.ingredients,
        customization_options: product.customization_options ?? undefined,
        image_url: product.image_url,
        is_available: product.is_available,
        is_popular: product.is_popular,
        is_new: product.is_new,
        branch_id: toBranchId,
        category_id: categoryId,
      },
    });

    const destSizeIdByName = new Map<string, number>();
    for (const s of product.sizes) {
      if (!s.is_active) continue;
      const createdSize = await this.prisma.productSize.create({
        data: {
          product_id: created.id,
          name: s.name,
          price: s.price,
          sort_order: s.sort_order,
          is_active: s.is_active,
        },
      });
      destSizeIdByName.set(s.name.trim().toLowerCase(), createdSize.id);
    }

    if (product.recipeItems.length > 0) {
      const recipeCreates: Prisma.ProductRecipeItemCreateManyInput[] = [];
      for (const row of product.recipeItems) {
        const destItem = await this.ensureInventoryItem(toBranchId, row.inventoryItem);
        let productSizeId: number | null = null;
        if (row.product_size_id != null && row.productSize) {
          productSizeId = destSizeIdByName.get(row.productSize.name.trim().toLowerCase()) ?? null;
        }
        recipeCreates.push({
          product_id: created.id,
          inventory_item_id: destItem.id,
          product_size_id: productSizeId,
          quantity: row.quantity,
        });
      }
      if (recipeCreates.length > 0) {
        await this.prisma.productRecipeItem.createMany({ data: recipeCreates });
      }
    }

    return created;
  }

  async transferProduct(productId: number, fromBranchId: number, toBranchId: number) {
    if (fromBranchId === toBranchId) {
      throw new BadRequestException('Source and destination branch must differ');
    }
    await this.findOne(productId, fromBranchId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: true,
        sizes: true,
        recipeItems: { include: { inventoryItem: true, productSize: true } },
      },
    });
    if (!product) throw new NotFoundException(`Product #${productId} not found`);

    const targetBranch = await this.prisma.branch.findUnique({ where: { id: toBranchId } });
    if (!targetBranch?.is_active) throw new NotFoundException('Target branch not found');

    const existing = await this.prisma.product.findFirst({
      where: { branch_id: toBranchId, name: product.name },
    });
    if (existing) {
      throw new BadRequestException(`Product "${product.name}" already exists in target branch`);
    }

    const category = await this.ensureCategory(toBranchId, product.category.name);
    const created = await this.cloneProductIntoBranch(product, toBranchId, category.id);

    return this.prisma.product.findUnique({
      where: { id: created.id },
      include: productInclude,
    });
  }

  /**
   * Copy every product (with its category, sizes and recipe) from one branch to another.
   * Products already present in the target branch (matched by name) are skipped.
   */
  async copyAllProducts(fromBranchId: number, toBranchId: number) {
    if (fromBranchId === toBranchId) {
      throw new BadRequestException('Source and destination branch must differ');
    }
    const targetBranch = await this.prisma.branch.findUnique({ where: { id: toBranchId } });
    if (!targetBranch?.is_active) throw new NotFoundException('Target branch not found');

    const products = await this.prisma.product.findMany({
      where: { branch_id: fromBranchId },
      include: {
        category: true,
        sizes: true,
        recipeItems: { include: { inventoryItem: true, productSize: true } },
      },
      orderBy: { id: 'asc' },
    });

    const existing = await this.prisma.product.findMany({
      where: { branch_id: toBranchId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((p) => p.name.trim().toLowerCase()));
    const categoryIdByName = new Map<string, number>();

    let copied = 0;
    let skipped = 0;
    for (const product of products) {
      const nameKey = product.name.trim().toLowerCase();
      if (existingNames.has(nameKey)) {
        skipped++;
        continue;
      }
      const catKey = product.category.name.trim().toLowerCase();
      let categoryId = categoryIdByName.get(catKey);
      if (categoryId == null) {
        const category = await this.ensureCategory(toBranchId, product.category.name);
        categoryId = category.id;
        categoryIdByName.set(catKey, categoryId);
      }
      await this.cloneProductIntoBranch(product, toBranchId, categoryId);
      existingNames.add(nameKey);
      copied++;
    }

    return {
      message: `Copied ${copied} product(s), skipped ${skipped} already present`,
      copied,
      skipped,
      total: products.length,
    };
  }
}
