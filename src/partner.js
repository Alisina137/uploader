import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { InputError } from './draft-model.js';

export function publishingKeys(encoded) {
  const key = Buffer.from(encoded || '', 'base64');
  if (key.length !== 32) return null;
  function signature(path, expires) {
    return createHmac('sha256', key).update(`media:${path}:${expires}`).digest('base64url');
  }
  return {
    seal(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    open(value) {
      const data = Buffer.from(value, 'base64');
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    },
    url(origin, path, expires) {
      const url = new URL(path, origin);
      url.search = new URLSearchParams({ expires, sig: signature(path, expires) });
      return url.href;
    },
    valid(url) {
      const expires = Number(url.searchParams.get('expires'));
      const given = Buffer.from(url.searchParams.get('sig') || '');
      const expected = Buffer.from(signature(url.pathname, expires));
      return Number.isSafeInteger(expires) && expires > Date.now() && given.length === expected.length && timingSafeEqual(given, expected);
    }
  };
}

export function ayrshare(apiKey, transport = fetch) {
  async function call(method, path, profile, body) {
    let response;
    try {
      response = await transport('https://api.ayrshare.com/api/' + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json',
          ...(profile && { 'Profile-Key': profile }) }, body: body && JSON.stringify(body)
      });
    } catch { throw new InputError('The publishing partner could not be reached.', 503); }
    const envelope = await response.json().catch(() => ({}));
    const result = envelope.posts?.[0] || envelope;
    if (!response.ok || (result.status === 'error' && !(method === 'GET' && path.startsWith('post/') && result.postIds))) {
      const message = String(result.errors?.[0]?.message || result.message || 'Partner request failed.').replace(/https?:\/\/[^\s]+/g,'[partner link]').replaceAll(profile || '\0','[profile]').replaceAll(apiKey || '\0','[key]').slice(0, 350);
      const error = new InputError(message, response.status >= 500 ? 503 : response.status === 429 ? 429 : 422);
      error.providerId = result.id;
      error.duplicate = /idempoten|duplicate/i.test(message);
      throw error;
    }
    return result;
  }
  return {
    async create(folder) {
      const data = await call('POST', 'profiles', null, { title: 'Upload Hub ' + folder.id });
      if (!data.profileKey) throw new InputError('The partner returned no profile key.', 502);
      return data.profileKey;
    },
    remove: (key) => call('DELETE', 'profiles', key),
    async accounts(key) {
      const data = await call('GET', 'user?instagramDetails=true', key);
      const instagram = data.displayNames?.find((item) => item.platform === 'instagram');
      const accounts = Object.fromEntries((data.activeSocialAccounts || []).map((network) => {
        const name = data.displayNames?.find((item) => item.platform === network);
        return [network, name?.displayName || name?.username || network];
      }));
      return { accounts, instagram, monthlyCount:data.monthlyPostCount, monthlyLimit:data.monthlyPostQuota };
    },
    async link(key, platform) {
      const data = await call('POST', 'profiles/link-sessions', key, { allowedSocial: [platform] });
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || url.hostname !== 'profile.ayrshare.com') throw new InputError('Invalid partner linking URL.', 502);
      return { url: url.href, expires: Date.parse(data.expiresAt) || Date.now() + 300000 };
    },
    disconnect: (key, platform) => call('DELETE', 'profiles/social', key, { platform }),
    post: (key, payload) => call('POST', 'post', key, payload),
    status: (key, id) => call('GET', 'post/' + encodeURIComponent(id), key)
  };
}
