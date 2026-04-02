import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import {
  buildWapilotPrimaryAuthHeaders,
  normalizeWapilotApiToken,
  parseWapilotExtraBody,
  parseWapilotExtraHeaders,
} from './wapilot-config.util';

const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Wapilot API v2 (https://app.wapilot.net/api-doc/v2):
 * POST https://api.wapilot.net/api/v2/{WAPILOT_INSTANCE_ID}/send-message
 * Body: { "chat_id": "<digits>@c.us", "text": "..." }. Auth: `token` header.
 * Set WAPILOT_SEND_MESSAGE_URL to override (e.g. legacy single-endpoint URLs).
 */
const LEGACY_WAPILOT_SEND_URL = 'https://api.wapilot.net/api/v2/message/send-message';

type WapilotPayloadStyle = 'wapilot' | 'wautopilot' | 'wapilot_path';

/** Not an instance unique name — these are shared API paths under /api/v2/{segment}/send-message. */
const WAPILOT_V2_SEND_PATH_SEGMENT_SKIP = new Set(
  ['messages', 'message', 'media', 'templates', 'flows', 'webhook', 'instances'].map((s) =>
    s.toLowerCase(),
  ),
);

/** Path-style v2: real instance in URL (e.g. instance3574), body { chat_id, text }. */
function isWapilotInstancePathSendUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    if (u.hostname !== 'api.wapilot.net') return false;
    const p = u.pathname.replace(/\/$/, '');
    const m = p.match(/^\/api\/v2\/([^/]+)\/send-message$/);
    if (!m) return false;
    return !WAPILOT_V2_SEND_PATH_SEGMENT_SKIP.has(m[1].toLowerCase());
  } catch {
    return false;
  }
}

@Injectable()
export class WebsitePhoneAuthService implements OnModuleInit {
  private readonly logger = new Logger(WebsitePhoneAuthService.name);

  constructor(
    private prisma: PrismaService,
    private customersService: CustomersService,
    private config: ConfigService,
  ) {}

  onModuleInit(): void {
    const configured = this.config.get<string>('WAPILOT_SEND_MESSAGE_URL')?.trim();
    if (configured?.includes('api.wapilot.net')) {
      try {
        const p = new URL(configured).pathname.replace(/\/$/, '');
        const seg = p.match(/^\/api\/v2\/([^/]+)\/send-message$/)?.[1]?.toLowerCase();
        if (seg && WAPILOT_V2_SEND_PATH_SEGMENT_SKIP.has(seg)) {
          this.logger.warn(
            `WAPILOT_SEND_MESSAGE_URL uses /api/v2/${seg}/send-message — that is not per-instance. Remove WAPILOT_SEND_MESSAGE_URL and set WAPILOT_INSTANCE_ID (e.g. instance3574) so requests go to /api/v2/{instance}/send-message with { chat_id, text }.`,
          );
        }
      } catch {
        /* ignore */
      }
    }
    const url = this.resolveWapilotSendUrl();
    if (url.includes('api.wapilot.net') && !this.config.get<string>('WAPILOT_INSTANCE_ID')?.trim()) {
      this.logger.warn(
        'WAPILOT_INSTANCE_ID is not set — default Wapilot URL is /api/v2/{instance}/send-message. Set it to your dashboard unique name (e.g. instance3574).',
      );
    }
  }

  /** Explicit URL, or https://api.wapilot.net/api/v2/{instance}/send-message when instance is set. */
  private resolveWapilotSendUrl(): string {
    const configured = this.config.get<string>('WAPILOT_SEND_MESSAGE_URL')?.trim();
    const instanceId = this.trimmedWapilotInstanceId();
    if (configured) {
      try {
        const u = new URL(configured);
        const p = u.pathname.replace(/\/$/, '');
        const m = p.match(/^\/api\/v2\/([^/]+)\/send-message$/);
        const seg = m?.[1]?.toLowerCase();
        if (
          u.hostname === 'api.wapilot.net' &&
          seg &&
          WAPILOT_V2_SEND_PATH_SEGMENT_SKIP.has(seg) &&
          instanceId
        ) {
          return `https://api.wapilot.net/api/v2/${encodeURIComponent(instanceId)}/send-message`;
        }
      } catch {
        /* use configured as-is */
      }
      return configured;
    }
    if (instanceId) {
      return `https://api.wapilot.net/api/v2/${encodeURIComponent(instanceId)}/send-message`;
    }
    return LEGACY_WAPILOT_SEND_URL;
  }

  private normalizePhone(phone: string): string {
    return phone.trim();
  }

  /**
   * E.164 digits only (no '+'). Egypt: leading 0 → 20…
   */
  private toMessagingDigits(phone: string): string {
    const compact = phone.replace(/\s+/g, '').trim();
    const digitsOnly = compact.replace(/\D/g, '');   
    if (compact.startsWith('+')) return digitsOnly;
    if (digitsOnly.startsWith('0') && digitsOnly.length >= 10) return '20' + digitsOnly.slice(1);
    if (digitsOnly.startsWith('20')) return digitsOnly;
    return digitsOnly;
  }

  private resolvePayloadStyle(url: string): WapilotPayloadStyle {
    const raw = this.config.get<string>('WAPILOT_MESSAGE_FORMAT')?.trim().toLowerCase();
    if (raw === 'wautopilot' || raw === 'wapilot' || raw === 'wapilot_path') {
      return raw as WapilotPayloadStyle;
    }
    if (isWapilotInstancePathSendUrl(url)) return 'wapilot_path';
    if (url.includes('wautopilot.com')) return 'wautopilot';
    if (url.includes('api.wapilot.net')) return 'wautopilot';
    return 'wapilot';
  }

  /** Trimmed instance identifier; omit empty strings so we never send `"instance_id":""`. */
  private trimmedWapilotInstanceId(): string | undefined {
    const v = this.config.get<string>('WAPILOT_INSTANCE_ID')?.trim();
    return v || undefined;
  }

  /** JSON property for the instance (dashboard "Unique Name" may map to e.g. `instance_unique_name`). */
  private wapilotInstanceBodyKey(): string {
    const k = this.config.get<string>('WAPILOT_INSTANCE_ID_BODY_KEY')?.trim();
    return k || 'instance_id';
  }

  private buildMessagingJsonBody(
    style: WapilotPayloadStyle,
    recipientDigits: string,
    text: string,
  ): Record<string, unknown> { 
    const instanceId = this.trimmedWapilotInstanceId();
    const instanceKey = this.wapilotInstanceBodyKey();

    let base: Record<string, unknown>;
    if (style === 'wapilot_path') {
      base = {
        chat_id: `${recipientDigits}@c.us`,
        text,
      };
    } else if (style === 'wautopilot') {
      base = {
        message: { type: 'text', text },
        recipient: recipientDigits,
      };
      if (instanceId) {
        base[instanceKey] = instanceId;
      }
    } else {
      base = {
        phone: recipientDigits,
        message: text,
      };
      if (instanceId) {
        base[instanceKey] = instanceId;
      }
    }
    const extra = parseWapilotExtraBody(this.config.get<string>('WAPILOT_EXTRA_BODY_JSON'));
    if (!extra) return base;
    return { ...base, ...extra };
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

  private resolveWapilotToken(): string | undefined {
    return (
      normalizeWapilotApiToken(this.config.get<string>('WAPILOT_API_TOKEN')) ??
      normalizeWapilotApiToken(this.config.get<string>('WAPILOT_API_KEY')) 
    );
  }

  private async sendWapilotTextOrThrow(recipientDigits: string, text: string): Promise<void> {
    const token = this.resolveWapilotToken();
    const url = this.resolveWapilotSendUrl();
    const authScheme = this.config.get<string>('WAPILOT_AUTH_SCHEME');

    if (!token) {
      this.logger.error('WAPILOT_API_TOKEN (or WAPILOT_API_KEY) is not set; cannot send OTP');
      throw new ServiceUnavailableException(
        'Verification codes are not configured. Please try again later.',
      );
    }

    if (!recipientDigits || recipientDigits.length < 8) {
      throw new BadRequestException('Invalid phone number for messaging');
    }

    const style = this.resolvePayloadStyle(url);
    const jsonBody = this.buildMessagingJsonBody(style, recipientDigits, text);
    const extraHeaders = parseWapilotExtraHeaders(
      this.config.get<string>('WAPILOT_EXTRA_HEADERS_JSON'),
    );
    if (extraHeaders) {
      delete extraHeaders.Authorization;
      delete extraHeaders.authorization;
      delete extraHeaders.token;
      delete extraHeaders.Token;
    }

    try {
      const primaryAuth = buildWapilotPrimaryAuthHeaders(url, token, authScheme);
      const headers: Record<string, string> = {
        ...primaryAuth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(extraHeaders ?? {}),
      };
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(jsonBody),
      });

      const raw = await res.text();
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }

      if (!res.ok) {
        this.logger.warn(
          `WhatsApp OTP send failed HTTP ${res.status} (${style} → ${url}): ${typeof body === 'string' ? body : JSON.stringify(body)}`,
        );
        if (res.status === 404 || res.status === 400) {
          const msg =
            body && typeof body === 'object' && 'message' in body
              ? String((body as { message?: unknown }).message)
              : '';
          if (msg.toLowerCase().includes('instance')) {
            this.logger.warn(
              'Wapilot returned an instance error — WAPILOT_INSTANCE_ID must match the path segment in /api/v2/{instance}/send-message (dashboard unique name). Or set WAPILOT_SEND_MESSAGE_URL to your exact endpoint. Legacy body-style: WAPILOT_MESSAGE_FORMAT=wautopilot + old URL.',
            );
          }
        }
        if (res.status === 401) {
          if (url.includes('api.wapilot.net')) {
            this.logger.warn( 
              '401 on api.wapilot.net: use the API token from the Wapilot dashboard (v2 docs). This host expects header `token: <your-key>`, not Bearer. Regenerate the key if needed (https://app.wapilot.net/api-doc/v2).',
            );
          } else if (url.includes('app.wapilot.io')) {
            this.logger.warn(
              '401 on app.wapilot.io: expects Authorization: Bearer <token>. Or switch default to api.wapilot.net (see WAPILOT_SEND_MESSAGE_URL).',
            );
          } else {
            this.logger.warn(
              '401: token rejected. For api.wapilot.net use `token` header (default); for wautopilot.com use Bearer + WAPILOT_MESSAGE_FORMAT=wautopilot.',
            );
          }
        }
        throw new ServiceUnavailableException(
          'Could not send your verification code. Please try again in a few minutes.',
        );
      }

      if (
        body &&
        typeof body === 'object' &&
        'success' in body &&
        (body as { success?: boolean }).success === false
      ) {
        this.logger.warn(`Provider reported success=false: ${JSON.stringify(body)}`);
        throw new ServiceUnavailableException(
          'Could not send your verification code. Please try again in a few minutes.',
        );
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException || err instanceof BadRequestException) {
        throw err;
      }
      this.logger.warn(
        `WhatsApp OTP request error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Could not send your verification code. Please try again in a few minutes.',
      );
    }
  }

  async sendOtp(rawPhone: string): Promise<{ is_new: boolean }> {
    const phone = this.normalizePhone(rawPhone);
    if (!phone || phone.length < 8) {
      throw new BadRequestException('Valid phone number is required');
    }

    const existing = await this.customersService.findByPhoneOptional(phone);
    const isNew = !existing;

    const code = this.randomOtp4();
    const recipient = this.toMessagingDigits(phone);
    const text = `Your BLENDiT verification code is: ${code}`;
    await this.sendWapilotTextOrThrow(recipient, text);

    await this.prisma.websiteOtpChallenge.deleteMany({ where: { phone } });
    await this.prisma.websiteOtpChallenge.create({
      data: {
        phone,
        code,
        expires_at: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    return { is_new: isNew };
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
