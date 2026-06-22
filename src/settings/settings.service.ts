import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';

const DEFAULT_STORE = {
  name: 'BLENDiT',
  address: '123 Flagship Street, New Cairo, Egypt',
  phone: '+20 111 638 4065',
  email: 'hello@blendit.com',
  taxRate: 10,
  currency: 'EGP',
  customerDisplayVideoUrl: '',
  customerDisplayVideoPath: '',
  customerDisplayTagline: 'Your order',
  openingHours: [
    { day: 'Monday', open: '07:00', close: '22:00', isClosed: false },
    { day: 'Tuesday', open: '07:00', close: '22:00', isClosed: false },
    { day: 'Wednesday', open: '07:00', close: '22:00', isClosed: false },
    { day: 'Thursday', open: '07:00', close: '22:00', isClosed: false },
    { day: 'Friday', open: '08:00', close: '23:00', isClosed: false },
    { day: 'Saturday', open: '08:00', close: '23:00', isClosed: false },
    { day: 'Sunday', open: '08:00', close: '22:00', isClosed: false },
  ],
};

const DEFAULT_LOYALTY = {
  pointsPerCurrency: 1,
  currencyValuePerPoint: 0.5,
  minimumPointsToRedeem: 100,
  welcomeBonus: 50,
  birthdayBonus: 100,
  referralBonus: 75,
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  private pickDefinedStorePatch(dto: UpdateStoreSettingsDto): Record<string, unknown> {
    const keys: (keyof UpdateStoreSettingsDto)[] = [
      'name',
      'address',
      'phone',
      'email',
      'taxRate',
      'currency',
      'openingHours',
      'customerDisplayVideoUrl',
      'customerDisplayVideoPath',
      'customerDisplayTagline',
    ];
    const patch: Record<string, unknown> = {};
    for (const key of keys) {
      const v = dto[key];
      if (v !== undefined) patch[key as string] = v as unknown;
    }
    return patch;
  }

  private async getByKey(branchId: number, key: string): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.setting.findUnique({
      where: { branch_id_key: { branch_id: branchId, key } },
    });
    return row ? (row.value as Record<string, unknown>) : null;
  }

  private async getStoreMerged(branchId: number): Promise<Record<string, unknown>> {
    const store = await this.getByKey(branchId, 'store');
    return { ...DEFAULT_STORE, ...(store ?? {}) };
  }

  sanitizeStoreForClient(store: Record<string, unknown>): Record<string, unknown> {
    const { managerPinHash, ...rest } = store;
    const hash = managerPinHash as string | undefined;
    return {
      ...rest,
      hasManagerPin: typeof hash === 'string' && hash.length > 0,
    };
  }

  async verifyManagerPin(branchId: number, plain: string | undefined): Promise<boolean> {
    const store = await this.getStoreMerged(branchId);
    const hash = store.managerPinHash as string | undefined;
    if (!hash || String(hash).trim() === '') return true;
    if (plain == null || String(plain).trim() === '') return false;
    return bcrypt.compare(String(plain).trim(), hash);
  }

  async isManagerPinConfigured(branchId: number): Promise<boolean> {
    const store = await this.getStoreMerged(branchId);
    const hash = store.managerPinHash as string | undefined;
    return typeof hash === 'string' && hash.length > 0;
  }

  /**
   * Authorize a sensitive POS action (refund / cancel). Fail-closed:
   * - When a manager PIN is configured, a valid PIN is always required.
   * - When no PIN is configured, the action is restricted to managers by role
   *   so a cashier can never perform it unguarded (previously this returned
   *   `true`, letting any cashier refund/cancel without authorization).
   * Throws ForbiddenException when not authorized.
   */
  async assertManagerAuthorization(
    branchId: number,
    role: string | undefined,
    plain: string | undefined,
  ): Promise<void> {
    const store = await this.getStoreMerged(branchId);
    const hash = store.managerPinHash as string | undefined;
    const configured = typeof hash === 'string' && hash.trim() !== '';
    if (!configured) {
      if (role === 'ADMIN' || role === 'SUPER_ADMIN') return;
      throw new ForbiddenException(
        'A manager PIN must be configured before this action can be authorized',
      );
    }
    const provided = plain == null ? '' : String(plain).trim();
    if (provided === '' || !(await bcrypt.compare(provided, hash as string))) {
      throw new ForbiddenException('Invalid manager PIN');
    }
  }

  private async setByKey(branchId: number, key: string, value: object): Promise<Record<string, unknown>> {
    const updated = await this.prisma.setting.upsert({
      where: { branch_id_key: { branch_id: branchId, key } },
      create: { branch_id: branchId, key, value: value as any },
      update: { value: value as any },
    });
    return updated.value as Record<string, unknown>;
  }

  async getAll(branchId: number): Promise<{ store: Record<string, unknown>; loyalty: Record<string, unknown> }> {
    const [storeMerged, loyalty] = await Promise.all([
      this.getStoreMerged(branchId),
      this.getByKey(branchId, 'loyalty'),
    ]);
    return {
      store: this.sanitizeStoreForClient(storeMerged),
      loyalty: loyalty ?? DEFAULT_LOYALTY,
    };
  }

  async getStore(branchId: number): Promise<Record<string, unknown>> {
    return this.sanitizeStoreForClient(await this.getStoreMerged(branchId));
  }

  async getLoyalty(branchId: number): Promise<Record<string, unknown>> {
    const loyalty = await this.getByKey(branchId, 'loyalty');
    return loyalty ?? DEFAULT_LOYALTY;
  }

  async updateStore(branchId: number, dto: UpdateStoreSettingsDto): Promise<Record<string, unknown>> {
    const current = await this.getStoreMerged(branchId);
    const patch = this.pickDefinedStorePatch(dto);
    const merged: Record<string, unknown> = { ...current, ...patch };

    if (dto.managerPin !== undefined) {
      const p = String(dto.managerPin).trim();
      if (p === '') {
        merged.managerPinHash = '';
      } else {
        if (p.length < 4) {
          throw new BadRequestException('Manager PIN must be at least 4 characters');
        }
        merged.managerPinHash = await bcrypt.hash(p, 10);
      }
    }

    if (patch.customerDisplayVideoUrl !== undefined) {
      const nextUrl = String(patch.customerDisplayVideoUrl).trim();
      if (nextUrl !== '') {
        merged.customerDisplayVideoPath = '';
        merged.customerDisplayVideoUrl = nextUrl;
      } else {
        merged.customerDisplayVideoUrl = '';
      }
    }

    if (patch.customerDisplayVideoPath !== undefined && String(patch.customerDisplayVideoPath).trim() !== '') {
      merged.customerDisplayVideoUrl = '';
    }

    const saved = await this.setByKey(branchId, 'store', merged);
    return this.sanitizeStoreForClient(saved as Record<string, unknown>);
  }

  async getCustomerDisplayPublic(branchId: number): Promise<{
    storeName: string;
    tagline: string;
    videoUrl: string | null;
    videoPath: string | null;
  }> {
    const store = await this.getStore(branchId);
    const name = (store.name as string) || 'BLENDiT';
    const tagline = (store.customerDisplayTagline as string) || 'Your order';
    const url = (store.customerDisplayVideoUrl as string)?.trim() || null;
    const path = (store.customerDisplayVideoPath as string)?.trim() || null;
    return {
      storeName: name,
      tagline,
      videoUrl: url,
      videoPath: path,
    };
  }

  async setCustomerDisplayVideoLocalPath(
    branchId: number,
    publicPath: string,
  ): Promise<Record<string, unknown>> {
    const current = await this.getStoreMerged(branchId);
    const saved = await this.setByKey(branchId, 'store', {
      ...current,
      customerDisplayVideoPath: publicPath.trim(),
      customerDisplayVideoUrl: '',
    });
    return this.sanitizeStoreForClient(saved as Record<string, unknown>);
  }

  async updateLoyalty(branchId: number, dto: UpdateLoyaltySettingsDto): Promise<Record<string, unknown>> {
    const current = await this.getLoyalty(branchId);
    const merged = { ...current, ...dto };
    return this.setByKey(branchId, 'loyalty', merged);
  }
}
