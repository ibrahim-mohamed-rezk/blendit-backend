import { BadRequestException, Injectable } from '@nestjs/common';
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

  /**
   * Merge DTO without letting `undefined` overwrite existing JSON (Nest DTO instances often
   * have undefined for every unset field — spreading them clears e.g. customerDisplayVideoPath).
   */
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

  private async getByKey(key: string): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row ? (row.value as Record<string, unknown>) : null;
  }

  /** Raw merged store JSON (includes `managerPinHash` — never send to clients). */
  private async getStoreMerged(): Promise<Record<string, unknown>> {
    const store = await this.getByKey('store');
    return { ...DEFAULT_STORE, ...(store ?? {}) };
  }

  /** Strips secret hash; exposes `hasManagerPin` for POS/admin UI. */
  sanitizeStoreForClient(store: Record<string, unknown>): Record<string, unknown> {
    const { managerPinHash, ...rest } = store;
    const hash = managerPinHash as string | undefined;
    return {
      ...rest,
      hasManagerPin: typeof hash === 'string' && hash.length > 0,
    };
  }

  /** Returns true when no PIN is configured, or when the plain PIN matches the hash. */
  async verifyManagerPin(plain: string | undefined): Promise<boolean> {
    const store = await this.getStoreMerged();
    const hash = store.managerPinHash as string | undefined;
    if (!hash || String(hash).trim() === '') return true;
    if (plain == null || String(plain).trim() === '') return false;
    return bcrypt.compare(String(plain).trim(), hash);
  }

  async isManagerPinConfigured(): Promise<boolean> {
    const store = await this.getStoreMerged();
    const hash = store.managerPinHash as string | undefined;
    return typeof hash === 'string' && hash.length > 0;
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
    const [storeMerged, loyalty] = await Promise.all([this.getStoreMerged(), this.getByKey('loyalty')]);
    return {
      store: this.sanitizeStoreForClient(storeMerged),
      loyalty: loyalty ?? DEFAULT_LOYALTY,
    };
  }

  async getStore(): Promise<Record<string, unknown>> {
    return this.sanitizeStoreForClient(await this.getStoreMerged());
  }

  async getLoyalty(): Promise<Record<string, unknown>> {
    const loyalty = await this.getByKey('loyalty');
    return loyalty ?? DEFAULT_LOYALTY;
  }

  async updateStore(dto: UpdateStoreSettingsDto): Promise<Record<string, unknown>> {
    const current = await this.getStoreMerged();
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
        // Switching to an external URL (or Cloudinary URL): use URL, clear legacy path.
        merged.customerDisplayVideoPath = '';
        merged.customerDisplayVideoUrl = nextUrl;
      } else {
        // Empty URL clears URL text while keeping any existing path value.
        merged.customerDisplayVideoUrl = '';
      }
    }

    if (patch.customerDisplayVideoPath !== undefined && String(patch.customerDisplayVideoPath).trim() !== '') {
      merged.customerDisplayVideoUrl = '';
    }

    const saved = await this.setByKey('store', merged);
    return this.sanitizeStoreForClient(saved as Record<string, unknown>);
  }

  /** Public payload for `/display` — no secrets */
  async getCustomerDisplayPublic(): Promise<{
    storeName: string;
    tagline: string;
    videoUrl: string | null;
    videoPath: string | null;
  }> {
    const store = await this.getStore();
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

  async setCustomerDisplayVideoCloudUrl(url: string): Promise<Record<string, unknown>> {
    const current = await this.getStoreMerged();
    const saved = await this.setByKey('store', {
      ...current,
      customerDisplayVideoPath: '',
      customerDisplayVideoUrl: url.trim(),
    });
    return this.sanitizeStoreForClient(saved as Record<string, unknown>);
  }

  async updateLoyalty(dto: UpdateLoyaltySettingsDto): Promise<Record<string, unknown>> {
    const current = await this.getLoyalty();
    const merged = { ...current, ...dto };
    return this.setByKey('loyalty', merged);
  }
}
