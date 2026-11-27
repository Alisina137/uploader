import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createToken, readSessionToken, sessionCookie, tokenHash, verifyPassword } from './auth.js';
import { settings, signIn } from './copy.js';
import { channelsView, loginView, messageView, settingsView } from './views.js';
import { normalizeTimeZone, validateProfile } from './validation.js';

const files = new Map([
  ['/styles.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../public/styles.css', import.meta.url)) }],
  ['/app.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../public/app.js', import.meta.url)) }]
]);
const formLimit = 8 * 1024;

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(body);
}

function redirect(response, location) {
  response.writeHead(303, { Location: location });
  response.end();
}

async function readForm(request) {
  const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  if (Number(request.headers['content-length']) > formLimit) return null;
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > formLimit) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function createApp({ store, origin }) {
  const secure = new URL(origin).protocol === 'https:';

  async function login(request, response, currentSession, form) {
    const email = (form.get('email') || '').trim().toLowerCase();
    const password = form.get('password') || '';
    const address = request.socket.remoteAddress || 'local';
    const wait = store.reserveLogin(address);
    if (wait) {
      response.setHeader('Retry-After', wait);
      return send(response, 429, loginView({ email, error: signIn.throttled }));
    }
    const owner = store.getOwner();
    const passwordMatches = owner && password.length > 0 && password.length <= 256
      && await verifyPassword(password, owner.password_hash);
    if (!passwordMatches || email !== store.getOwner()?.email) {
      return send(response, 401, loginView({ email, error: signIn.invalid }));
    }

    const token = createToken();
    store.createSession(tokenHash(token));
    if (currentSession) store.deleteSession(currentSession);
    store.clearAttempts(address);
    store.setInitialTimeZone(normalizeTimeZone(form.get('timeZone')) || 'UTC');
    response.setHeader('Set-Cookie', sessionCookie(token, secure));
    return redirect(response, '/channels');
  }

  function saveSettings(response, owner, form) {
    const name = (form.get('name') || '').trim();
    const email = (form.get('email') || '').trim().toLowerCase();
    const timeZone = normalizeTimeZone(form.get('timeZone'));
    const errors = validateProfile(name, email);
    if (!timeZone) errors.timeZone = settings.invalidTimeZone;
    const values = { name, email, timeZone };
    if (Object.keys(errors).length) return send(response, 422, settingsView(owner, { values, errors }));
    store.saveSettings(owner.id, values);
    return send(response, 200, settingsView({ ...owner, ...values }, { saved: true }));
  }

  async function handle(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');

    const path = new URL(request.url, origin).pathname;
    const asset = files.get(path);
    if (request.method === 'GET' && asset) {
      response.writeHead(200, { 'Content-Type': asset.type });
      return response.end(asset.body);
    }

    const token = readSessionToken(request, secure);
    const currentSession = token ? tokenHash(token) : null;
    const owner = currentSession ? store.findSession(currentSession) : null;

    if (request.method === 'GET') {
      if (path === '/') return redirect(response, owner ? '/channels' : '/login');
      if (path === '/login') return owner ? redirect(response, '/channels') : send(response, 200, loginView());
      if (path === '/channels') return owner ? send(response, 200, channelsView(owner)) : redirect(response, '/login');
      if (path === '/settings') return owner ? send(response, 200, settingsView(owner)) : redirect(response, '/login');
    }

    if (request.method === 'POST' && ['/login', '/settings', '/logout'].includes(path)) {
      if (request.headers.origin !== origin) {
        return send(response, 403, messageView('Request denied', 'Open Upload Hub at its configured address and try again.', owner));
      }
      if (path === '/logout') {
        if (currentSession) store.deleteSession(currentSession);
        response.setHeader('Set-Cookie', sessionCookie(null, secure));
        return redirect(response, '/login');
      }
      if (path === '/settings' && !owner) return redirect(response, '/login');
      if (path === '/login' && owner) return redirect(response, '/channels');
      const form = await readForm(request);
      if (!form) return send(response, 400, messageView('Invalid request', 'Reload the page and try again.', owner));
      return path === '/login' ? login(request, response, currentSession, form) : saveSettings(response, owner, form);
    }

    return send(response, 404, messageView('Page not found', 'This page is unavailable.', owner));
  }

  return createServer({ requestTimeout: 30_000, headersTimeout: 15_000, maxHeaderSize: 16 * 1024 }, (request, response) => {
    handle(request, response).catch((error) => {
      if (request.destroyed || response.headersSent) {
        response.destroy();
        return;
      }
      console.error(error);
      send(response, 500, messageView('Something went wrong', 'Please try again.'));
    });
  });
}
