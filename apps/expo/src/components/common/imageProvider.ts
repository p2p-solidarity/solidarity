/**
 * Image provider — TS port of solidarity/Services/Utils/ImageProvider.swift.
 *
 * Swift's variant loads bundled animal PNGs with a small filesystem
 * fallback. The Expo client doesn't ship those PNGs yet (see animals.ts)
 * but we still need a uniform "resolve an image source to a renderable
 * uri" entry point — sakura attachments, contact avatars, OCR scans —
 * with a two-tier cache:
 *   1. in-memory map keyed by sha256 of the source uri / base64
 *   2. disk cache under documentDir/images/ so the same uri across cold
 *      starts hits the local file instead of re-downloading.
 *
 * Resolution rules (mirroring Swift's "try exact, then numbered, then
 * SF Symbol"):
 *   - source.base64        → write to disk cache, return file:// uri
 *   - source.uri (file://) → return as-is (no copy)
 *   - source.uri (data:)   → decode payload, behave like base64
 *   - source.uri (https:)  → download once into disk cache, return file://
 *   - source.uri (other)   → return as-is, caller decides
 */
import * as FileSystem from 'expo-file-system/legacy';

import { bytesToHex, sha256Bytes, utf8ToBytes } from '@solidarity/shared';

const IMAGE_CACHE_DIR = `${FileSystem.documentDirectory ?? ''}images/`;

export interface ImageSource {
  readonly uri?: string;
  readonly base64?: string;
}

const memoryCache = new Map<string, string>();

function cacheKey(source: ImageSource): string {
  const seed = source.base64 ?? source.uri ?? '';
  return bytesToHex(sha256Bytes(utf8ToBytes(seed)));
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(IMAGE_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(IMAGE_CACHE_DIR, { intermediates: true });
  }
}

function fileForKey(key: string): string {
  return `${IMAGE_CACHE_DIR}${key}`;
}

async function writeBase64(key: string, base64: string): Promise<string> {
  await ensureDir();
  const path = fileForKey(key);
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

async function downloadToCache(uri: string, key: string): Promise<string | undefined> {
  await ensureDir();
  const path = fileForKey(key);
  const existing = await FileSystem.getInfoAsync(path);
  if (existing.exists) return path;
  try {
    const result = await FileSystem.downloadAsync(uri, path);
    return result.uri;
  } catch {
    return undefined;
  }
}

export async function resolveImage(source: ImageSource): Promise<string | undefined> {
  const key = cacheKey(source);
  const cached = memoryCache.get(key);
  if (cached) return cached;

  if (source.base64) {
    const path = await writeBase64(key, source.base64);
    memoryCache.set(key, path);
    return path;
  }

  const uri = source.uri;
  if (!uri) return undefined;

  if (uri.startsWith('data:')) {
    const commaIdx = uri.indexOf(',');
    const base64 = commaIdx >= 0 ? uri.slice(commaIdx + 1) : '';
    if (!base64) return undefined;
    const path = await writeBase64(key, base64);
    memoryCache.set(key, path);
    return path;
  }

  if (uri.startsWith('file://') || uri.startsWith('content://')) {
    memoryCache.set(key, uri);
    return uri;
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const downloaded = await downloadToCache(uri, key);
    if (downloaded) memoryCache.set(key, downloaded);
    return downloaded;
  }

  // Unknown scheme — return as-is so the caller can decide (e.g. asset:// uris).
  memoryCache.set(key, uri);
  return uri;
}

export function clearCache(): void {
  memoryCache.clear();
  FileSystem.deleteAsync(IMAGE_CACHE_DIR, { idempotent: true }).catch(() => {
    // Disk clear is best-effort — a leftover dir just gets re-used next launch.
  });
}
