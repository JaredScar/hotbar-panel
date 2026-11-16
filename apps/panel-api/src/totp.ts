import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomBase32(size = 20): string {
  const bytes = crypto.randomBytes(size);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let index = 0; index + 5 <= bits.length; index += 5) {
    out += ALPHABET[Number.parseInt(bits.slice(index, index + 5), 2)];
  }
  return out;
}

export function totp(secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((step) => totp(secret, at + step * 30_000) === code);
}

function decodeBase32(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/=+$/g, '');
  let bits = '';
  for (const char of cleaned) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) throw new Error('secret is not valid');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}
