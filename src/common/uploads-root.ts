import { isAbsolute, join, resolve } from 'path';

/**
 * Directory on disk where `products/` and `customer-display/` subfolders are stored.
 * Set `UPLOADS_ROOT` in `.env` to an absolute path outside the repo so redeploys (git clean) do not delete uploads.
 */
export function resolveUploadsRootDir(envValue: string | undefined | null, cwd = process.cwd()): string {
  const raw = typeof envValue === 'string' ? envValue.trim() : '';
  if (!raw) return join(cwd, 'uploads');
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}
