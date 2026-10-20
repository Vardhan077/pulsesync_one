import assert from 'node:assert/strict';
import { encryptToken, decryptToken } from '../services/integration/crypto.js';

const secret = 'security-test-secret-0123456789-ABCDEF';
const plaintext = 'test-access-token-do-not-use-in-production';
const encrypted = encryptToken(plaintext, secret);
assert.ok(encrypted.encryptedData);
assert.ok(encrypted.iv);
assert.ok(encrypted.authTag);
assert.notEqual(encrypted.encryptedData, plaintext);
assert.equal(decryptToken(encrypted.encryptedData, encrypted.iv, encrypted.authTag, secret), plaintext);
assert.throws(() => encryptToken(plaintext, 'too-short'), /ENCRYPTION_SECRET/);

const originalConsoleError = console.error;
try {
  console.error = () => {};
  assert.equal(decryptToken(encrypted.encryptedData, encrypted.iv, encrypted.authTag, 'wrong-secret-that-is-long-enough'), '');
} finally {
  console.error = originalConsoleError;
}
console.log('Credential crypto regression tests passed (7 assertions).');
