import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export const AVATAR_PRESETS = [
  '🦊',
  '🐼',
  '🐯',
  '🦁',
  '🐸',
  '🐺',
  '🦉',
  '🐙',
  '🦄',
  '🐲',
  '🤖',
  '👾'
] as const;

type ImageKind = 'jpg' | 'png' | 'webp';

/** Validate the actual file signature, not only the user-controlled MIME type. */
function detectImage(buffer: Buffer): ImageKind | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export async function saveAvatar(buffer: Buffer): Promise<string> {
  const kind = detectImage(buffer);
  if (!kind) throw new AppError(415, 'UNSUPPORTED_IMAGE', 'Загрузите JPG, PNG или WebP');

  const dir = path.join(config.uploadDir, 'avatars');
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${kind}`;
  await writeFile(path.join(dir, filename), buffer, { mode: 0o644 });
  return `/uploads/avatars/${filename}`;
}
