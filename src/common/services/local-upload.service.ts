import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveUploadsRootDir } from '../uploads-root';

export type LocalUploadSubfolder = 'products' | 'customer-display';

export type LocalUploadResult = {
  /** URL path served by Express, e.g. `/uploads/products/abc.webp` */
  path: string;
  filename: string;
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

@Injectable()
export class LocalUploadService {
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    this.root = resolveUploadsRootDir(this.config.get<string>('UPLOADS_ROOT'), process.cwd());
  }

  async saveBuffer(
    buffer: Buffer,
    opts: { mimetype: string; originalname?: string; subfolder: LocalUploadSubfolder },
  ): Promise<LocalUploadResult> {
    const ext = this.resolveExtension(opts.mimetype, opts.originalname);
    const filename = `${randomBytes(16).toString('hex')}${ext}`;
    const dir = join(this.root, opts.subfolder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buffer);
    const publicPath = `/uploads/${opts.subfolder}/${filename}`;
    return { path: publicPath, filename };
  }

  private resolveExtension(mimetype: string, originalname?: string): string {
    const base = mimetype.toLowerCase().split(';')[0]?.trim() ?? '';
    if (MIME_TO_EXT[base]) return MIME_TO_EXT[base];
    if (originalname && /\.[a-z0-9]+$/i.test(originalname)) {
      return originalname.slice(originalname.lastIndexOf('.')).toLowerCase();
    }
    throw new BadRequestException(`Unsupported file type: ${mimetype}`);
  }
}
