import { Injectable } from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';
import { basename, join } from 'path';
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

const CUSTOMER_DISPLAY_UPLOAD_DIR = join(process.cwd(), 'uploads', 'customer-display');

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  /** Remove a file under uploads/customer-display only (no path traversal). */
  unlinkCustomerDisplayFile(relativePath: string): void {
    if (!relativePath || typeof relativePath !== 'string') return;
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized.startsWith('/uploads/customer-display/')) return;
    const name = basename(normalized);
    if (!name || name === '.' || name === '..' || name.includes('..')) return;
    const abs = join(CUSTOMER_DISPLAY_UPLOAD_DIR, name);
    if (!abs.startsWith(CUSTOMER_DISPLAY_UPLOAD_DIR)) return;
    if (existsSync(abs)) {
      try {
        unlinkSync(abs);
      } catch {
        // ignore
      }
    }
  }

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
    const patch = this.pickDefinedStorePatch(dto);
    const merged: Record<string, unknown> = { ...current, ...patch };

    const prevPath = String(current.customerDisplayVideoPath ?? '').trim();
    const prevUrl = String(current.customerDisplayVideoUrl ?? '').trim();

    let pathToDeleteAfterSave: string | null = null;

    if (patch.customerDisplayVideoUrl !== undefined) {
      const nextUrl = String(patch.customerDisplayVideoUrl).trim();
      if (nextUrl !== '') {
        // Switching to external URL: drop upload (delete file after DB save succeeds)
        merged.customerDisplayVideoPath = '';
        merged.customerDisplayVideoUrl = nextUrl;
        if (prevPath) pathToDeleteAfterSave = prevPath;
      } else {
        // Empty URL: keep uploaded file if any; only clear URL text
        merged.customerDisplayVideoUrl = '';
        if (prevPath) merged.customerDisplayVideoPath = prevPath;
      }
    }

    if (patch.customerDisplayVideoPath !== undefined && String(patch.customerDisplayVideoPath).trim() !== '') {
      merged.customerDisplayVideoUrl = '';
    }

    const saved = await this.setByKey('store', merged);
    if (pathToDeleteAfterSave) this.unlinkCustomerDisplayFile(pathToDeleteAfterSave);
    return saved;
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

  async setCustomerDisplayVideoUpload(relativePath: string): Promise<Record<string, unknown>> {
    const current = await this.getStore();
    const newPath = relativePath.trim();
    const oldPath = String(current.customerDisplayVideoPath ?? '').trim();
    const saved = await this.setByKey('store', {
      ...current,
      customerDisplayVideoPath: newPath,
      customerDisplayVideoUrl: '',
    });
    if (oldPath && oldPath !== newPath) {
      this.unlinkCustomerDisplayFile(oldPath);
    }
    return saved;
  }

  async updateLoyalty(dto: UpdateLoyaltySettingsDto): Promise<Record<string, unknown>> {
    const current = await this.getLoyalty();
    const merged = { ...current, ...dto };
    return this.setByKey('loyalty', merged);
  }
}
