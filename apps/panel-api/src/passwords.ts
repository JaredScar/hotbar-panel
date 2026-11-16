import crypto from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function pairingCode(): string {
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  const { argon2id } = await import('hash-wasm');
  return argon2id({
    password,
    salt: crypto.randomBytes(16),
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function checkPassword(password: string, encoded: string): Promise<boolean> {
  const { argon2Verify } = await import('hash-wasm');
  return argon2Verify({ password, hash: encoded });
}
