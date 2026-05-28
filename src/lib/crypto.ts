import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || "mezz-watch-encryption-key-32ch!!";
  return Buffer.from(raw.padEnd(KEY_LENGTH, "!").slice(0, KEY_LENGTH));
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(ciphertext: string): string {
  const [ivHex, encHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function maskSecret(value: string): string {
  if (value.length <= 6) return "***";
  return value.slice(0, 3) + "***" + value.slice(-3);
}
