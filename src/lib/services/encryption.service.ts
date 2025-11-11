/**
 * Component: Encryption Service
 * Documentation: documentation/backend/services/config.md
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class EncryptionService {
  private key: Buffer;

  constructor() {
    const encryptionKey = process.env.CONFIG_ENCRYPTION_KEY;

    if (!encryptionKey) {
      throw new Error('CONFIG_ENCRYPTION_KEY environment variable is not set');
    }

    // Ensure key is exactly 32 bytes
    if (encryptionKey.length < KEY_LENGTH) {
      // Pad with zeros if too short
      this.key = Buffer.alloc(KEY_LENGTH);
      Buffer.from(encryptionKey).copy(this.key);
    } else if (encryptionKey.length > KEY_LENGTH) {
      // Truncate if too long
      this.key = Buffer.from(encryptionKey).subarray(0, KEY_LENGTH);
    } else {
      this.key = Buffer.from(encryptionKey);
    }
  }

  /**
   * Encrypt a plaintext string
   * @param plaintext - The string to encrypt
   * @returns Base64-encoded string in format: iv:authTag:encryptedData
   */
  encrypt(plaintext: string): string {
    try {
      // Generate random IV for this encryption
      const iv = crypto.randomBytes(IV_LENGTH);

      // Create cipher
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

      // Encrypt data
      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');

      // Get auth tag
      const authTag = cipher.getAuthTag();

      // Combine IV, auth tag, and encrypted data
      const result = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;

      return result;
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt an encrypted string
   * @param encryptedData - Base64-encoded string in format: iv:authTag:encryptedData
   * @returns Decrypted plaintext string
   */
  decrypt(encryptedData: string): string {
    try {
      // Split the encrypted data
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const [ivBase64, authTagBase64, encrypted] = parts;

      // Decode components
      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');

      // Create decipher
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      // Decrypt data
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a random encryption key (32 bytes)
   * @returns Base64-encoded random key
   */
  static generateKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString('base64');
  }
}

// Singleton instance
let encryptionService: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionService) {
    encryptionService = new EncryptionService();
  }
  return encryptionService;
}
