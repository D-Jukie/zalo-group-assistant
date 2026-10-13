import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = Readonly<{ iv: string; tag: string; data: string }>;

// AES-256-GCM; the secret's name is authenticated so a ciphertext cannot be swapped under another name.
export function encryptSecret(plaintext: string, key: Buffer, name: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

// Returns undefined when the key is wrong or the stored value was tampered with.
export function decryptSecret(secret: EncryptedSecret, key: Buffer, name: string): string | undefined {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
    decipher.setAAD(Buffer.from(name, "utf8"));
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(secret.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}
