import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrderStatus, TransactionStatus } from '@prisma/client';
import { OrdersService } from './orders.service';

/**
 * Service-level money-path coverage: free-item discounts, refund guards, and the
 * manager-PIN authorization that gates refunds and cancellations. Prisma and the
 * settings service are mocked so we exercise the branching logic, not the DB.
 */
function build() {
  const prisma = {
    order: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };
  const eventEmitter = { emit: jest.fn() };
  const settingsService = {
    assertManagerAuthorization: jest.fn().mockResolvedValue(undefined),
  };
  const activityLogs = { create: jest.fn().mockResolvedValue(undefined) };
  const inventoryService = {};
  const service = new OrdersService(
    prisma as never,
    eventEmitter as never,
    settingsService as never,
    activityLogs as never,
    inventoryService as never,
  );
  return { service, prisma, settingsService, eventEmitter, activityLogs };
}

describe('free-item discount math', () => {
  it('prices one free unit per listed product id', () => {
    const { service } = build();
    const items = [
      { product_id: 1, quantity: 2, price: 30 },
      { product_id: 2, quantity: 1, price: 50 },
    ];
    const discount = (service as never as {
      computeSequentialFreeUnitsDiscount: (i: unknown, ids: number[]) => number;
    }).computeSequentialFreeUnitsDiscount(items, [1, 2]);
    expect(discount).toBe(80); // 30 + 50, one unit each
  });

  it('lets the same product be free up to its quantity, then throws', () => {
    const { service } = build();
    const calc = (service as never as {
      computeSequentialFreeUnitsDiscount: (i: unknown, ids: number[]) => number;
    }).computeSequentialFreeUnitsDiscount;
    expect(calc.call(service, [{ product_id: 1, quantity: 2, price: 30 }], [1, 1])).toBe(60);
    expect(() =>
      calc.call(service, [{ product_id: 1, quantity: 1, price: 30 }], [1, 1]),
    ).toThrow(BadRequestException);
  });

  it('throws when a free product is not in the order', () => {
    const { service } = build();
    expect(() =>
      (service as never as {
        computeSequentialFreeUnitsDiscount: (i: unknown, ids: number[]) => number;
      }).computeSequentialFreeUnitsDiscount([{ product_id: 1, quantity: 1, price: 30 }], [99]),
    ).toThrow(BadRequestException);
  });

  it('computeFreeProductDiscount prices a single free unit, or 0 if absent', () => {
    const { service } = build();
    const fn = (service as never as {
      computeFreeProductDiscount: (i: unknown, pid: number) => number;
    }).computeFreeProductDiscount;
    expect(fn.call(service, [{ product_id: 5, quantity: 3, price: 25 }], 5)).toBe(25);
    expect(fn.call(service, [{ product_id: 1, quantity: 1, price: 10 }], 9)).toBe(0);
  });
});

describe('refund guards & manager-PIN authorization', () => {
  const user = { id: 7, role: { name: 'ADMIN' } };

  it('rejects when there is no completed payment to refund', async () => {
    const { service, prisma } = build();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: OrderStatus.COMPLETED, branch_id: 2, notes: null } as never);
    prisma.order.findUnique.mockResolvedValue({ id: 1, transactions: [] });
    await expect(service.refund(1, {} as never, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an already-cancelled order', async () => {
    const { service, prisma } = build();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: OrderStatus.CANCELLED, branch_id: 2, notes: null } as never);
    prisma.order.findUnique.mockResolvedValue({
      id: 1,
      transactions: [{ status: TransactionStatus.COMPLETED }],
    });
    await expect(service.refund(1, {} as never, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks the refund (no DB mutation) when manager authorization fails', async () => {
    const { service, prisma, settingsService } = build();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: OrderStatus.COMPLETED, branch_id: 2, notes: null } as never);
    prisma.order.findUnique.mockResolvedValue({
      id: 1,
      transactions: [{ status: TransactionStatus.COMPLETED }],
    });
    settingsService.assertManagerAuthorization.mockRejectedValue(new ForbiddenException('Invalid manager PIN'));
    await expect(service.refund(1, { manager_pin: 'x' } as never, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(settingsService.assertManagerAuthorization).toHaveBeenCalledWith(2, 'ADMIN', 'x');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('authorizes before mutating when guards pass', async () => {
    const { service, prisma, settingsService } = build();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: OrderStatus.COMPLETED, branch_id: 2, notes: null } as never);
    prisma.order.findUnique.mockResolvedValue({
      id: 1,
      transactions: [{ status: TransactionStatus.COMPLETED }],
    });
    const sentinel = new Error('transaction-reached');
    prisma.$transaction.mockRejectedValue(sentinel);
    await expect(service.refund(1, { manager_pin: '1234' } as never, user)).rejects.toBe(sentinel);
    expect(settingsService.assertManagerAuthorization).toHaveBeenCalledWith(2, 'ADMIN', '1234');
  });
});

describe('cancel (updateStatus) guards & authorization', () => {
  it('rejects changing an already-cancelled order', async () => {
    const { service } = build();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: OrderStatus.CANCELLED, branch_id: 2 } as never);
    await expect(
      service.updateStatus(1, { status: OrderStatus.COMPLETED } as never, { role: { name: 'ADMIN' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forbids a cashier from changing a non-pending order to a non-cancel status', async () => {
    const { service } = build();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: OrderStatus.COMPLETED, branch_id: 2 } as never);
    await expect(
      service.updateStatus(1, { status: OrderStatus.PENDING } as never, { role: { name: 'CASHIER' } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a cashier to attempt cancel on a completed order (manager PIN checked next)', async () => {
    const { service, settingsService } = build();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: OrderStatus.COMPLETED, branch_id: 2, notes: null } as never);
    settingsService.assertManagerAuthorization.mockRejectedValue(new ForbiddenException('Invalid manager PIN'));
    await expect(
      service.updateStatus(
        1,
        { status: OrderStatus.CANCELLED, manager_pin: '1234' } as never,
        { role: { name: 'CASHIER' } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settingsService.assertManagerAuthorization).toHaveBeenCalledWith(2, 'CASHIER', '1234');
  });

  it('requires manager authorization to cancel (no DB mutation on failure)', async () => {
    const { service, settingsService, prisma } = build();
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: OrderStatus.COMPLETED, branch_id: 2 } as never);
    settingsService.assertManagerAuthorization.mockRejectedValue(new ForbiddenException('Invalid manager PIN'));
    await expect(
      service.updateStatus(
        1,
        { status: OrderStatus.CANCELLED, manager_pin: 'bad' } as never,
        { role: { name: 'ADMIN' } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settingsService.assertManagerAuthorization).toHaveBeenCalledWith(2, 'ADMIN', 'bad');
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});
