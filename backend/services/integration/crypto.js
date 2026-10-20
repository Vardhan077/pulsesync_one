import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
function getDerivedKey(secret = process.env.ENCRYPTION_SECRET) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('ENCRYPTION_SECRET must be configured with at least 32 characters before storing or reading CRM credentials.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts sensitive text using AES-256-GCM
 * @param {string} plainText
 * @param {string} [secret]
 * @returns {{ encryptedData: string, iv: string, authTag: string }}
 */
export function encryptToken(plainText, secret = process.env.ENCRYPTION_SECRET) {
  if (!plainText) return { encryptedData: '', iv: '', authTag: '' };
  
  const key = getDerivedKey(secret);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag
  };
}

/**
 * Decrypts AES-256-GCM encrypted text
 * @param {string} encryptedData
 * @param {string} ivHex
 * @param {string} authTagHex
 * @param {string} [secret]
 * @returns {string}
 */
export function decryptToken(encryptedData, ivHex, authTagHex, secret = process.env.ENCRYPTION_SECRET) {
  if (!encryptedData || !ivHex || !authTagHex) return '';
  
  try {
    const key = getDerivedKey(secret);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('Failed to decrypt credential token:', err.message);
    return '';
  }
}
