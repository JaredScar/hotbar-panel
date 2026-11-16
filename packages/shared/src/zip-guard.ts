export const ZIP_LIMITS = {
  maxEntries: 10_000,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
} as const;

export interface ZipEntry {
  name: string;
  uncompressedBytes: number;
}

export interface ZipAssessment {
  ok: boolean;
  errors: string[];
}

export function assessZipEntries(entries: readonly ZipEntry[]): ZipAssessment {
  const errors: string[] = [];
  if (entries.length > ZIP_LIMITS.maxEntries) {
    errors.push(`zip has ${entries.length} entries; limit is ${ZIP_LIMITS.maxEntries}`);
  }
  let total = 0;
  for (const entry of entries) {
    if (!entry.name || entry.name.includes('\0')) {
      errors.push('zip entry name is empty or contains NUL');
      continue;
    }
    const normalized = entry.name.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
      errors.push(`zip entry escapes the destination: ${entry.name}`);
    }
    if (!Number.isFinite(entry.uncompressedBytes) || entry.uncompressedBytes < 0) {
      errors.push(`zip entry has an invalid size: ${entry.name}`);
      continue;
    }
    if (entry.uncompressedBytes > ZIP_LIMITS.maxEntryBytes) {
      errors.push(`zip entry exceeds the size limit: ${entry.name}`);
    }
    total += entry.uncompressedBytes;
  }
  if (total > ZIP_LIMITS.maxTotalBytes) {
    errors.push('zip uncompressed size exceeds the limit');
  }
  return { ok: errors.length === 0, errors };
}
