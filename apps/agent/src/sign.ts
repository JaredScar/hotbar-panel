import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

export interface SignedEnvelope {
  payload: string;
  signature: string;
}

export function generateEd25519(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function publicKeyFromPrivate(privatePem: string): string {
  const key = createPrivateKey(privatePem);
  return createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
}

export function assertEd25519PublicKey(pem: string): void {
  if (pem.length > 4000) throw new Error('public key is invalid');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('public key is invalid');
}

export function envelope(privatePem: string, message: unknown): string {
  const payload = JSON.stringify(message);
  const signature = sign(null, Buffer.from(payload), createPrivateKey(privatePem)).toString('base64');
  return JSON.stringify({ payload, signature } satisfies SignedEnvelope);
}

export function openEnvelope<T>(publicPem: string, raw: string): T | null {
  let parsed: SignedEnvelope;
  try {
    parsed = JSON.parse(raw) as SignedEnvelope;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.payload !== 'string' || typeof parsed.signature !== 'string') return null;
  try {
    const ok = verify(null, Buffer.from(parsed.payload), createPublicKey(publicPem), Buffer.from(parsed.signature, 'base64'));
    if (!ok) return null;
    return JSON.parse(parsed.payload) as T;
  } catch {
    return null;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
