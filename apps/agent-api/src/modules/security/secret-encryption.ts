import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

export interface WrappedKeyMaterial {
  wrappedKey: string;
  kekId: string;
}

export interface EncryptionContext {
  userId: string;
  purpose: "gemini_api_key";
}

export interface StoredEncryptedSecret {
  algorithm: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDek: string;
  kekId: string;
}

export interface KeyWrappingService {
  wrapKey(
    plaintextDek: Buffer,
    context: EncryptionContext
  ): Promise<WrappedKeyMaterial>;
  unwrapKey(
    material: WrappedKeyMaterial,
    context: EncryptionContext
  ): Promise<Buffer>;
}

export interface SecretEncryptionService {
  encryptPlaintext(
    plaintext: string,
    context: EncryptionContext
  ): Promise<StoredEncryptedSecret>;
  decryptToPlaintext(
    encrypted: StoredEncryptedSecret,
    context: EncryptionContext
  ): Promise<string>;
}

export class EnvelopeEncryptionService implements SecretEncryptionService {
  constructor(private readonly keyWrappingService: KeyWrappingService) {}

  async encryptPlaintext(
    plaintext: string,
    context: EncryptionContext
  ): Promise<StoredEncryptedSecret> {
    if (!plaintext.trim()) {
      throw new Error("Cannot encrypt an empty secret");
    }

    const dek = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    const wrapped = await this.keyWrappingService.wrapKey(dek, context);

    return {
      algorithm: "aes-256-gcm",
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      wrappedDek: wrapped.wrappedKey,
      kekId: wrapped.kekId
    };
  }

  async decryptToPlaintext(
    encrypted: StoredEncryptedSecret,
    context: EncryptionContext
  ): Promise<string> {
    const dek = await this.keyWrappingService.unwrapKey(
      {
        wrappedKey: encrypted.wrappedDek,
        kekId: encrypted.kekId
      },
      context
    );

    const decipher = createDecipheriv(
      encrypted.algorithm,
      dek,
      Buffer.from(encrypted.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final()
    ]);

    return plaintext.toString("utf8");
  }
}

export class InMemoryKeyWrappingService implements KeyWrappingService {
  async wrapKey(
    plaintextDek: Buffer,
    _context: EncryptionContext
  ): Promise<WrappedKeyMaterial> {
    return {
      wrappedKey: plaintextDek.toString("base64"),
      kekId: "in-memory-kek-v1"
    };
  }

  async unwrapKey(
    material: WrappedKeyMaterial,
    _context: EncryptionContext
  ): Promise<Buffer> {
    return Buffer.from(material.wrappedKey, "base64");
  }
}
