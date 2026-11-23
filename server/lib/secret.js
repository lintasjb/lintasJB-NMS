import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const SECRET_FILE = path.join(DATA_DIR, 'secrets.json');

let cache = null;

function load() {
  if (cache) return cache;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let stored = {};
  if (fs.existsSync(SECRET_FILE)) {
    try {
      stored = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8'));
    } catch {
      stored = {};
    }
  }
  let changed = false;
  for (const key of ['jwt', 'license', 'encryption']) {
    if (!stored[key]) {
      stored[key] = crypto.randomBytes(32).toString('hex');
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(SECRET_FILE, JSON.stringify(stored, null, 2));
    try {
      fs.chmodSync(SECRET_FILE, 0o600);
    } catch {
      /* Windows */
    }
  }
  cache = stored;
  return cache;
}

export function getJwtSecret() {
  return process.env.JWT_SECRET || load().jwt;
}

export function getLicenseSecret() {
  return process.env.LICENSE_SECRET || load().license;
}

function encryptionKey() {
  const raw = process.env.ENCRYPTION_KEY || load().encryption;
  return crypto.createHash('sha256').update(String(raw)).digest();
}

/** AES-256-GCM sealed string, prefixed with `enc:`. */
export function seal(value) {
  if (value === undefined || value === null || value === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function unseal(value) {
  if (!value) return '';
  if (!String(value).startsWith('enc:')) return String(value);
  try {
    const [, ivB64, tagB64, dataB64] = String(value).split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

export function hasSecret(value) {
  return Boolean(value && String(value).length > 3);
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export { DATA_DIR };
