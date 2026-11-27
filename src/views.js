import { brand, navigation, settings, signIn } from './copy.js';
import { timeZones } from './validation.js';

const iconPaths = {
  logo: '<path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M12 16V4m-5 5 5-5 5 5"/>',
  channels: '<path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  settings: '<path d="M4 7h3m4 0h9M4 17h9m4 0h3"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>'
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${iconPaths[name]}</svg>`;
}

export function escape(value = '') {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]);
}

function brandMark() {
  return `<span class="brand"><span class="brand-icon">${icon('logo')}</span>${brand}</span>`;
}

function document(title, content) {
  return `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light dark">
    <title>${title} | ${brand}</title>
    <link rel="stylesheet" href="/styles.css">
    <script src="/app.js" defer></script>
    <script src="/drafts.js" type="module"></script>
  </head>
  <body>${content}</body>
</html>`;
}

function fieldError(name, error) {
  return error ? `<p class="field-error" id="${name}-error">${escape(error)}</p>` : '';
}

export function textField({ name, label, value, error, hint, type = 'text', autocomplete, limit }) {
  const description = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ');
  return `<div class="field">
    <label for="${name}">${label}</label>
    <input id="${name}" name="${name}" type="${type}" maxlength="${limit}" autocomplete="${autocomplete}"
      ${value === undefined ? '' : `value="${escape(value)}"`} required
      ${error ? 'aria-invalid="true"' : ''} ${description ? `aria-describedby="${description}"` : ''}>
    ${hint ? `<p class="hint" id="${name}-hint">${hint}</p>` : ''}
    ${fieldError(name, error)}
  </div>`;
}

export function loginView({ email = '', error = '' } = {}) {
  return document(signIn.title, `<main class="login">
    ${brandMark()}
    <div class="card login-card">
      <h1>${signIn.title}</h1>
      <p class="intro">${signIn.intro}</p>
      ${error ? `<p class="notice error" role="alert" tabindex="-1" data-focus>${escape(error)}</p>` : ''}
      <form method="post" action="/login">
        ${textField({ name: 'email', label: 'Email', value: email, type: 'email', autocomplete: 'username', limit: 254 })}
        ${textField({ name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', limit: 256 })}
        <input type="hidden" name="timeZone" data-browser-zone>
        <button class="primary" type="submit">${signIn.title}</button>
      </form>
    </div>
  </main>`);
}

export function shell({ title, path, owner, body }) {
  const links = Object.entries(navigation).map(([key, label]) =>
    `<a href="/${key}" ${path === `/${key}` ? 'aria-current="page"' : ''}>${icon(key)}<span>${label}</span></a>`
  ).join('');
  return document(title, `<a href="#main" class="skip">Skip to content</a>
    <div class="shell">
      <aside class="sidebar">
        <a href="/channels" class="sidebar-brand">${brandMark()}</a>
        <nav aria-label="Main navigation">${links}</nav>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <a href="/channels" class="mobile-brand">${brandMark()}</a>
          <details class="account">
            <summary>
              <span class="avatar" aria-hidden="true">${escape(Array.from(owner.name)[0]?.toLocaleUpperCase('en'))}</span>
              <span class="account-name">${escape(owner.name)}</span>${icon('chevron')}
            </summary>
            <div class="account-actions">
              <a href="/settings">Settings</a>
              <form method="post" action="/logout"><button type="submit">Sign out</button></form>
            </div>
          </details>
        </header>
        <main id="main" class="content" tabindex="-1">${body}</main>
      </div>
    </div>`);
}

export function settingsView(owner, { values = owner, errors = {}, saved = false } = {}) {
  const options = timeZones.map((zone) =>
    `<option value="${zone}" ${(values.timeZone ?? values.time_zone) === zone ? 'selected' : ''}>${zone.replaceAll('_', ' ')}</option>`
  ).join('');
  const hasErrors = Object.keys(errors).length > 0;
  return shell({
    title: settings.title, path: '/settings', owner,
    body: `<h1>${settings.title}</h1>
    <p class="intro">${settings.intro}</p>
    <form method="post" action="/settings" class="settings-form">
      ${hasErrors ? '<p class="notice error" role="alert" tabindex="-1" data-focus>Check the highlighted fields and try again.</p>' : ''}
      <section class="card settings-card" aria-labelledby="profile-title">
        <h2 id="profile-title">${settings.profile}</h2>
        ${textField({ name: 'name', label: 'Name', value: values.name, error: errors.name, autocomplete: 'name', limit: 80 })}
        ${textField({ name: 'email', label: 'Email', value: values.email, error: errors.email, hint: settings.emailHint, type: 'email', autocomplete: 'email', limit: 254 })}
      </section>
      <section class="card settings-card" aria-labelledby="zone-title">
        <h2 id="zone-title">${settings.timeZone}</h2>
        <div class="field">
          <label for="timeZone">Preferred time zone</label>
          <select id="timeZone" name="timeZone" required
            aria-describedby="zone-hint${errors.timeZone ? ' timeZone-error' : ''}"
            ${errors.timeZone ? 'aria-invalid="true"' : ''}>
            <option value="" disabled ${errors.timeZone ? 'selected' : ''}>Select a time zone</option>${options}
          </select>
          <p class="hint" id="zone-hint">${settings.timeZoneHint}</p>
          ${fieldError('timeZone', errors.timeZone)}
        </div>
      </section>
      <button class="primary" type="submit">${settings.save}</button>
      ${saved ? `<p class="notice success" role="status" tabindex="-1" data-focus>${settings.saved}</p>` : ''}
    </form>`
  });
}

export function messageView(title, message, owner) {
  const body = `<h1>${title}</h1><p class="intro">${message}</p>
    <a class="button-link" href="${owner ? '/channels' : '/login'}">${owner ? 'Back to Channels' : 'Back to sign in'}</a>`;
  if (owner) return shell({ title, path: '', owner, body });
  return document(title, `<main class="login">${brandMark()}<div class="card login-card">${body}</div></main>`);
}
