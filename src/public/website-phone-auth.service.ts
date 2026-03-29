import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import twilio from 'twilio';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';

/** Used when Twilio is not configured or SMS send fails (local / staging). */
const FALLBACK_OTP = '1111';
const OTP_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class WebsitePhoneAuthService {
  private readonly logger = new Logger(WebsitePhoneAuthService.name);

  constructor(
    private prisma: PrismaService,
    private customersService: CustomersService,
    private config: ConfigService,
  ) {}

  private normalizePhone(phone: string): string {
    return phone.trim();
  }

  /** E.164 for Twilio; assumes Egypt +20 when local format starts with 0. */
  private toE164ForSms(phone: string): string {
    const compact = phone.replace(/\s+/g, '').trim();
    if (compact.startsWith('+')) return compact;
    const d = compact.replace(/\D/g, '');
    if (d.startsWith('0') && d.length >= 10) return '+20' + d.slice(1);
    if (d.startsWith('20')) return '+' + d;
    return '+' + d;
  }

  private randomOtp4(): string {
    return String(1000 + crypto.randomInt(9000));
  }

  private safeEqualOtp(a: string, b: string): boolean {
    const aa = Buffer.from(a.trim(), 'utf8');
    const bb = Buffer.from(b.trim(), 'utf8');
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  }

  async sendOtp(rawPhone: string): Promise<{ is_new: boolean; sms_queued: boolean }> {
    const phone = this.normalizePhone(rawPhone);
    if (!phone || phone.length < 8) {
      throw new BadRequestException('Valid phone number is required');
    }

    const existing = await this.customersService.findByPhoneOptional(phone);
    const isNew = !existing;

    let code = this.randomOtp4();
    let smsQueued = false;

    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim();
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim();
    const from = this.config.get<string>('TWILIO_SMS_FROM')?.trim();

    if (!sid || !token || !from) {
      this.logger.warn('Twilio not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM); using fallback OTP 1111');
      code = FALLBACK_OTP;
    } else {
      try {
        const client = twilio(sid, token);
        const to = this.toE164ForSms(phone);
        await client.messages.create({
          body: `Your BLENDiT verification code is: ${code}`,
          from,
          to,
        });
        smsQueued = true;
      } catch (err) {
        this.logger.warn(
          `Twilio SMS failed; using fallback OTP ${FALLBACK_OTP}: ${err instanceof Error ? err.message : String(err)}`,
        );
        code = FALLBACK_OTP;
        smsQueued = false;
      }
    }

    await this.prisma.websiteOtpChallenge.deleteMany({ where: { phone } });
    await this.prisma.websiteOtpChallenge.create({
      data: {
        phone,
        code,
        expires_at: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    return { is_new: isNew, sms_queued: smsQueued };
  }

  async verifyOtp(rawPhone: string, rawCode: string, name?: string) {
    const phone = this.normalizePhone(rawPhone);
    const code = rawCode?.trim() ?? '';
    if (!phone || !code) {
      throw new BadRequestException('Phone and verification code are required');
    }

    const row = await this.prisma.websiteOtpChallenge.findFirst({
      where: { phone, expires_at: { gt: new Date() } },
      orderBy: { id: 'desc' },
    });

    if (!row || !this.safeEqualOtp(row.code, code)) {
      throw new BadRequestException('Invalid or expired code');
    }

    await this.prisma.websiteOtpChallenge.deleteMany({ where: { phone } });

    const existing = await this.customersService.findByPhoneOptional(phone);
    if (existing) {
      return existing;
    }

    const n = name?.trim();
    if (!n) {
      throw new BadRequestException('Name is required to create your account');
    }

    return this.customersService.register({ name: n, phone });
  }
}
