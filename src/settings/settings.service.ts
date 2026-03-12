import { Injectable } from '@nestjs/common';
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

  private async getByKey(key: string): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row ? (row.value as Record<string, unknown>) : null;
  }

  private async setByKey(key: string, value: object): Promise<Record<string, unknown>> {
    const updated = await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: value as any },
      update: { value: value as any },
    });
    return updated.value as Record<string, unknown>;
  }

  async getAll(): Promise<{ store: Record<string, unknown>; loyalty: Record<string, unknown> }> {
    const [store, loyalty] = await Promise.all([
      this.getByKey('store'),
      this.getByKey('loyalty'),
    ]);
    return {
      store: store ?? DEFAULT_STORE,
      loyalty: loyalty ?? DEFAULT_LOYALTY,
    };
  }

  async getStore(): Promise<Record<string, unknown>> {
    const store = await this.getByKey('store');
    return store ?? DEFAULT_STORE;
  }

  async getLoyalty(): Promise<Record<string, unknown>> {
    const loyalty = await this.getByKey('loyalty');
    return loyalty ?? DEFAULT_LOYALTY;
  }

  async updateStore(dto: UpdateStoreSettingsDto): Promise<Record<string, unknown>> {
    const current = await this.getStore();
    const merged = { ...current, ...dto };
    return this.setByKey('store', merged);
  }

  async updateLoyalty(dto: UpdateLoyaltySettingsDto): Promise<Record<string, unknown>> {
    const current = await this.getLoyalty();
    const merged = { ...current, ...dto };
    return this.setByKey('loyalty', merged);
  }
}
