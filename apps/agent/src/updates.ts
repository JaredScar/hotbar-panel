import crypto from 'node:crypto';

/** A release is accepted only when the manifest bytes verify with the published Ed25519 key. A missing signature is a refusal. */
export function acceptSignedManifest(manifest: string, signatureBase64: string, publicPem: string): boolean {
  if (!manifest || !signatureBase64 || !publicPem.includes('PUBLIC KEY')) return false;
  try {
    return crypto.verify(null, Buffer.from(manifest, 'utf8'), publicPem, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}
