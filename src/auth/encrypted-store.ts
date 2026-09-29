import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";

interface EncryptedEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

function decodeMasterKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64url");
  if (decoded.length !== 32) {
    throw new Error("FOMO_MCP_MASTER_KEY must be 32 bytes as hex or base64url");
  }
  return decoded;
}

export function generateMasterKey(): string {
  return randomBytes(32).toString("base64url");
}

export class EncryptedJsonStore<T> {
  constructor(private readonly filePath: string, private readonly masterKey: string | undefined) {}

  private key(): Buffer {
    if (!this.masterKey) throw new Error("FOMO_MCP_MASTER_KEY is required for encrypted auth storage");
    return decodeMasterKey(this.masterKey);
  }

  async read(): Promise<T | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
      throw new Error(`Unsupported encrypted state format: ${this.filePath}`);
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  }

  async write(value: T): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    await writeFile(this.filePath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.filePath, 0o600);
  }
}
