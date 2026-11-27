import { publishService } from './publishing.js';
import { publishingRoutes } from './publish-routes.js';
import { mediaDirectory } from './config.js';
import { mediaStorage } from './media.js';
import { draftRoutes } from './draft-routes.js';
import { json, readForm, redirect, send } from './http.js';
import { InputError } from './draft-model.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createToken, readSessionToken, sessionCookie, tokenHash, verifyPassword } from './auth.js';
import { settings, signIn } from './copy.js';
import { loginView, messageView, settingsView } from './views.js';
import { normalizeTimeZone, validateProfile } from './validation.js';

const files = new Map([
  ['/styles.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('../public/styles.css', import.meta.url)) }],
  ...['drafts', 'uploads'].map((name) => [`/${name}.js`,
    { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL(`../public/${name}.js`, import.meta.url)) }]),
  ['/app.js', { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('../public/app.js', import.meta.url)) }]
]);
export function createApp({ store, origin, media = mediaStorage(mediaDirectory, store), publishing = publishService(store) }) {
  const publishRoutes = publishingRoutes(store,publishing);
  const handleDraft = draftRoutes(store, media, publishing, publishRoutes);
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
    return redirect(response, owner.onboarded ? '/channels' : '/onboarding');
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
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self' https://profile.ayrshare.com; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');

    const url = new URL(request.url, origin);
    const path = url.pathname;
    if (path.startsWith('/delivery/')) {
      const delivery = /^\/delivery\/([a-f0-9-]{36})\/(video\.(?:mp4|mov)|cover\.(?:png|jpg))$/.exec(path);
      const allowed = ['GET','HEAD'].includes(request.method) && delivery && publishing.keys?.valid(url);
      const job = allowed && store.publishing.target(delivery[1]);
      const video = job && store.getVideo(job.channel_id,job.video_id);
      if (!video) return send(response,404,'Media unavailable');
      if (delivery[2].startsWith('video')) return media.stream(video,request,response);
      const image = store.getThumbnail(video.id);
      if (!image) return send(response,404,'Thumbnail unavailable');
      response.writeHead(200,{'Content-Type':image.mime,'Content-Length':image.data.length});
      return response.end(request.method === 'HEAD' ? undefined : image.data);
    }
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

    if (path === '/activity' || path === '/activity/retry' || path === '/onboarding' || path === '/channels' || path.startsWith('/channels/')) {
      const wantsJson = request.headers.accept === 'application/json';
      if (!owner) return wantsJson ? json(response, 401, { error: 'Sign in to continue.' }) : redirect(response, '/login');
      if (request.method !== 'GET' && request.headers.origin !== origin) {
        return wantsJson ? json(response, 403, { error: 'Open Upload Hub at its configured address.' })
          : send(response, 403, messageView('Request denied', 'Open Upload Hub at its configured address and try again.', owner));
      }
      if (path.startsWith('/activity')) return publishRoutes.activity(request,response,url,owner);
      return handleDraft(request, response, url, owner);
    }

    return send(response, 404, messageView('Page not found', 'This page is unavailable.', owner));
  }

  const server = createServer({ requestTimeout: 120_000, headersTimeout: 15_000, maxHeaderSize: 16 * 1024 }, (request, response) => {
    handle(request, response).catch((error) => {
      if (response.destroyed || response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof InputError) return send(response, error.status, messageView('Invalid request', error.message));
      console.error(error);
      send(response, 500, messageView('Something went wrong', 'Please try again.'));
    });
  });
  let timer;
  server.once('listening', () => {
    timer = setInterval(() => publishing.tick().catch(() => console.error('Publishing worker could not check its queue.')), 3000);
    timer.unref();
  });
  server.once('close', () => clearInterval(timer));
  return server;
}
