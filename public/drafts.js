import { setupUpload } from './uploads.js';

const upload = document.querySelector('[data-upload]');
if (upload) setupUpload(upload);

for (const link of document.querySelectorAll('[data-list-filter], .pagination a, [aria-label="Folder status"] a')) {
  const event = link.tagName === 'FORM' ? 'submit' : 'click';
  link.addEventListener(event, (action) => {
    if (action.defaultPrevented || action.ctrlKey || action.metaKey || action.shiftKey || action.altKey) return;
    const results = document.querySelector('[data-list-results]');
    if (!results) return;
    results.setAttribute('aria-busy', 'true');
    results.classList.add('list-loading');
    const feedback = document.createElement('p');
    feedback.setAttribute('role', 'status');
    feedback.className = 'list-progress';
    feedback.textContent = 'Loading results…';
    for (let i = 0; i < 3; i++) {
      const line = document.createElement('span');
      line.className = 'skeleton-line';
      line.ariaHidden = 'true';
      feedback.append(line);
    }
    results.prepend(feedback);
    window.addEventListener('pageshow', () => {
      results.removeAttribute('aria-busy');
      results.classList.remove('list-loading');
      feedback.remove();
    }, { once: true });
  });
}

const list = document.querySelector('[data-video-list]');
try {
  if (list) sessionStorage.setItem('upload-hub:filters:' + location.pathname, location.search);
  for (const link of document.querySelectorAll('[data-videos-back]')) {
    const filters = sessionStorage.getItem('upload-hub:filters:' + new URL(link.href).pathname);
    if (filters?.startsWith('?')) link.href += filters;
  }
} catch { /* Links still work when session storage is unavailable. */ }

for (const field of document.querySelectorAll('[data-chip-field]')) {
  const input = field.querySelector('input');
  const chips = field.querySelector('[data-chips]');
  function renderChips() {
    const values = input.value.split(',').map((value) => value.trim()).filter(Boolean);
    chips.replaceChildren(...values.map((value, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'badge removable-chip';
      chip.disabled = input.matches(':disabled');
      chip.textContent = value + ' ×';
      chip.setAttribute('aria-label', 'Remove ' + value);
      chip.addEventListener('click', () => {
        input.value = values.filter((_, position) => position !== index).join(', ');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
      return chip;
    }));
  }
  input.addEventListener('input', renderChips);
  renderChips();
}

async function draftRequest(url, options) {
  const response = await fetch(url, { ...options, headers: { Accept: 'application/json' } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The change could not be saved. Try again.');
}

const details = document.querySelector('[data-draft-details]:has([data-autosave])');
const autosaveLabel = details?.querySelector('[data-autosave]');
let dirty = false;
let timer;
let pending = Promise.resolve();

function saveDetails() {
  if (!details || !dirty) return pending;
  if (!details.reportValidity()) return Promise.reject(new Error('Check the draft fields before continuing.'));
  clearTimeout(timer);
  const payload = new URLSearchParams(new FormData(details));
  dirty = false;
  autosaveLabel.textContent = 'Saving…';
  pending = pending.catch(() => {}).then(() => draftRequest(details.action, { method: 'POST', body: payload }))
    .then(() => {
      if (!dirty) autosaveLabel.textContent = 'Draft changes saved.';
    }).catch((error) => {
      dirty = true;
      autosaveLabel.textContent = error.message;
      throw error;
    });
  return pending;
}

if (details) {
  const title = details.elements.title;
  const count = details.querySelector('[data-title-count]');
  const warning = details.querySelector('[data-suggested]');
  details.addEventListener('input', () => {
    count.textContent = `${title.value.length}/100 characters`;
    warning.hidden = details.elements.format.value === warning.dataset.suggested;
    dirty = true;
    autosaveLabel.textContent = '';
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (details.checkValidity()) saveDetails().catch(() => {});
    }, 5000);
  });
  function leave(event, url) {
    event.preventDefault();
    saveDetails().then(() => location.assign(url)).catch((error) => {
      autosaveLabel.textContent = error.message;
    });
  }
  details.addEventListener('submit', (event) => {
    leave(event, details.action.replace(/details$/, 'platforms'));
  });
  for (const step of document.querySelectorAll('[data-draft-steps] a:not([aria-current])')) {
    step.addEventListener('click', (event) => leave(event, step.href));
  }
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
  });
}

const thumbnail = document.querySelector('[data-thumbnail-editor]');
const pick = thumbnail?.querySelector('[data-pick-frame]');
if (pick) {
  const url = thumbnail.dataset.thumbnailEditor;
  const image = thumbnail.querySelector('[data-thumbnail]');
  const picker = thumbnail.querySelector('[data-thumbnail-file]');
  const remove = thumbnail.querySelector('[data-remove-thumbnail]');
  const status = thumbnail.querySelector('[data-thumbnail-status]');
  const seconds = thumbnail.querySelector('[data-frame-time]');
  const video = thumbnail.querySelector('video');
  video.addEventListener('error', () => { thumbnail.querySelector('[data-preview-error]').hidden = false; });
  video.addEventListener('seeked', () => { seconds.value = video.currentTime.toFixed(2); });

  async function update(method, body) {
    for (const control of [picker, pick, remove]) control.disabled = true;
    status.textContent = method === 'DELETE' ? 'Removing thumbnail…' : 'Preparing thumbnail…';
    try {
      if (method !== 'DELETE') await saveDetails();
      await draftRequest(url, { method, body });
      image.hidden = remove.hidden = method === 'DELETE';
      if (!image.hidden) image.src = `${url}?version=${Date.now()}`;
      status.textContent = method === 'DELETE' ? 'Thumbnail removed.' : 'Thumbnail saved.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      for (const control of [picker, pick, remove]) control.disabled = false;
      picker.value = '';
    }
  }
  picker.addEventListener('change', () => {
    if (picker.files[0]) update('POST', picker.files[0]);
  });
  pick.addEventListener('click', () => {
    if (seconds.reportValidity()) update('POST', new URLSearchParams({ seconds: seconds.value }));
  });
  remove.addEventListener('click', () => update('DELETE'));
}
