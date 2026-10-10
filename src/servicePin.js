import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'pos.sqlite'));
const keyPath = `${databasePath}.pin-key`;

function loadKey() {
  const configured = process.env.SERVICE_PIN_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-f\d]{64}$/i.test(configured)) throw new Error('SERVICE_PIN_ENCRYPTION_KEY harus 64 karakter hex');
    return Buffer.from(configured, 'hex');
  }
  try {
    const saved = fs.readFileSync(keyPath, 'utf8').trim();
    if (/^[a-f\d]{64}$/i.test(saved)) return Buffer.from(saved, 'hex');
    throw new Error('Kunci enkripsi PIN servis tidak valid');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600, flag: 'wx' });
    return key;
  }
}

const encryptionKey = loadKey();

export function encryptServicePin(value) {
  const pin = String(value || '');
  if (!pin) return pin;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptServicePin(value) {
  if (!value || !value.startsWith('enc:v1:')) return value || '';
  const [, , ivHex, tagHex, encryptedHex] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}
