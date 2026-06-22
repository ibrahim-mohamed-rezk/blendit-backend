import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.branch.findMany({ orderBy: { name: 'asc' } });
  }

  findOne(id: number) {
    return this.prisma.branch.findUnique({ where: { id } });
  }

  create(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  update(id: number, dto: UpdateBranchDto) {
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  /**
   * Permanently delete a branch and ALL of its data (products, categories,
   * orders, inventory, shifts, settings, etc.). Staff accounts are kept — their
   * home branch is just cleared. Run as a single transaction so it either fully
   * succeeds or rolls back. The Main branch is protected.
   */
  async remove(id: number) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException(`Branch #${id} not found`);
    if (branch.slug === 'main') {
      throw new BadRequestException('The Main branch cannot be deleted');
    }

    await this.prisma.$transaction(async (tx) => {
      const orderRows = await tx.order.findMany({
        where: { branch_id: id },
        select: { id: true },
      });
      const orderIds = orderRows.map((o) => o.id);

      const productRows = await tx.product.findMany({
        where: { branch_id: id },
        select: { id: true },
      });
      const productIds = productRows.map((p) => p.id);

      // --- Order-dependent rows (must go before orders) ---
      if (orderIds.length > 0) {
        // Loyalty history belongs to global customers; just unlink the orders.
        await tx.loyaltyTransaction.updateMany({
          where: { related_order_id: { in: orderIds } },
          data: { related_order_id: null },
        });
        await tx.transaction.deleteMany({ where: { order_id: { in: orderIds } } });
        await tx.orderAddon.deleteMany({ where: { order_id: { in: orderIds } } });
        await tx.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      }
      await tx.deliveryOrder.deleteMany({ where: { branch_id: id } });
      await tx.order.deleteMany({ where: { branch_id: id } });
      await tx.heldOrder.deleteMany({ where: { branch_id: id } });

      // --- Things that reference products (must go before products) ---
      await tx.bogoOffer.deleteMany({ where: { branch_id: id } });
      await tx.loyaltyGift.deleteMany({ where: { branch_id: id } });
      if (productIds.length > 0) {
        await tx.productRecipeItem.deleteMany({ where: { product_id: { in: productIds } } });
        await tx.customerFavorite.deleteMany({ where: { product_id: { in: productIds } } });
        await tx.productSize.deleteMany({ where: { product_id: { in: productIds } } });
      }

      // --- Products / categories / inventory ---
      await tx.product.deleteMany({ where: { branch_id: id } });
      await tx.category.deleteMany({ where: { branch_id: id } });
      await tx.stockTransaction.deleteMany({ where: { branch_id: id } });
      await tx.inventoryItem.deleteMany({ where: { branch_id: id } });

      // --- Remaining branch-scoped data ---
      await tx.addon.deleteMany({ where: { branch_id: id } });
      await tx.promotion.deleteMany({ where: { branch_id: id } });
      await tx.shift.deleteMany({ where: { branch_id: id } });
      await tx.setting.deleteMany({ where: { branch_id: id } });
      await tx.activityLog.deleteMany({ where: { branch_id: id } });
      await tx.userBranch.deleteMany({ where: { branch_id: id } });

      // Keep staff accounts, but clear their home branch pointer.
      await tx.user.updateMany({ where: { branch_id: id }, data: { branch_id: null } });

      await tx.branch.delete({ where: { id } });
    });

    return { id, deleted: true };
  }
}
