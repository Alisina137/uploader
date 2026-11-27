import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sessionLifetime } from './store.js';

const deriveKey = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, 64, options);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(':').map((hex) => Buffer.from(hex, 'hex'));
  const actual = await deriveKey(password, salt, expected.length, options);
  return timingSafeEqual(actual, expected);
}

export function readSessionToken(request, secure) {
  const name = secure ? '__Host-upload_hub' : 'upload_hub';
  const cookie = request.headers.cookie?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  const token = cookie?.slice(name.length + 1);
  return /^[a-f\d]{64}$/.test(token || '') ? token : null;
}

export function sessionCookie(token, secure) {
  const name = secure ? '__Host-upload_hub' : 'upload_hub';
  const maxAge = token ? sessionLifetime : 0;
  return `${name}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export const createToken = () => randomBytes(32).toString('hex');
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
