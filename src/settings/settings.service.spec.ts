import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Covers the fail-closed manager-PIN authorization used by refund / cancel.
 * Regression guard for the previous fail-open behavior (no PIN configured used
 * to let any cashier through).
 */
describe('SettingsService.assertManagerAuthorization', () => {
  let service: SettingsService;
  let findUnique: jest.Mock;

  beforeEach(() => {
    findUnique = jest.fn();
    const prisma = { setting: { findUnique } } as unknown as PrismaService;
    service = new SettingsService(prisma);
  });

  /** Stub the persisted store settings row (null = no row → no PIN configured). */
  const storeWith = (managerPinHash?: string) =>
    findUnique.mockResolvedValue(managerPinHash != null ? { value: { managerPinHash } } : null);

  it('allows ADMIN when no PIN is configured', async () => {
    storeWith(undefined);
    await expect(service.assertManagerAuthorization(1, 'ADMIN', undefined)).resolves.toBeUndefined();
  });

  it('allows SUPER_ADMIN when no PIN is configured', async () => {
    storeWith(undefined);
    await expect(
      service.assertManagerAuthorization(1, 'SUPER_ADMIN', undefined),
    ).resolves.toBeUndefined();
  });

  it('blocks CASHIER when no PIN is configured (fail closed)', async () => {
    storeWith(undefined);
    await expect(service.assertManagerAuthorization(1, 'CASHIER', undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows CASHIER with the correct PIN', async () => {
    storeWith(bcrypt.hashSync('1234', 10));
    await expect(service.assertManagerAuthorization(1, 'CASHIER', '1234')).resolves.toBeUndefined();
  });

  it('blocks CASHIER with a wrong PIN', async () => {
    storeWith(bcrypt.hashSync('1234', 10));
    await expect(service.assertManagerAuthorization(1, 'CASHIER', '9999')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('requires the PIN even for ADMIN once one is configured', async () => {
    storeWith(bcrypt.hashSync('1234', 10));
    await expect(service.assertManagerAuthorization(1, 'ADMIN', undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
