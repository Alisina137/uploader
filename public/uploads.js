class UploadError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function uploadRequest(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', ...options?.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !data.duplicate) throw new UploadError(data.error || 'Upload request failed.', response.status);
  return data;
}

export function setupUpload(panel) {
  const base = panel.dataset.upload;
  const key = 'upload-hub:' + base;
  const input = panel.querySelector('input');
  const zone = panel.querySelector('.dropzone');
  const progress = panel.querySelector('progress');
  const status = panel.querySelector('[data-upload-status]');
  const resume = panel.querySelector('[data-resume]');
  const cancel = panel.querySelector('[data-cancel]');
  const duplicate = panel.querySelector('[data-duplicate]');
  const existing = panel.querySelector('[data-existing]');
  const anyway = panel.querySelector('[data-anyway]');
  let file;
  let transfer;
  let current;

  try { transfer = JSON.parse(localStorage.getItem(key)); } catch { /* Resume is still possible in this tab. */ }

  function remember(value) {
    transfer = value;
    try {
      if (value) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch { /* Storage can be unavailable in a private browser. */ }
  }

  const fingerprint = (value) => JSON.stringify([value.name, value.size, value.lastModified]);
  function updateControls() {
    const matches = !transfer || (file && transfer.fingerprint === fingerprint(file));
    resume.disabled = Boolean(current) || !file || !matches || !duplicate.hidden;
    input.disabled = Boolean(current);
    cancel.hidden = !transfer;
    anyway.disabled = Boolean(current);
  }

  function selectFile(selected) {
    if (!selected || current) return;
    file = selected;
    duplicate.hidden = true;
    if (transfer && transfer.fingerprint !== fingerprint(file)) {
      status.textContent = `Choose ${transfer.name} to resume or cancel the previous upload.`;
    } else if (!/\.(mp4|mov)$/i.test(file.name)) {
      file = null;
      status.textContent = 'Choose an MP4 or MOV file.';
    } else {
      status.textContent = file.name;
    }
    updateControls();
  }

  function showProgress(offset) {
    progress.hidden = false;
    progress.value = Math.floor(offset / transfer.size * 100);
    status.textContent = `Uploading ${transfer.name} · ${progress.value}%`;
  }

  async function upload(allowDuplicate = false) {
    if (current || (!file && !allowDuplicate)) return;
    const controller = new AbortController();
    const { signal } = controller;
    current = controller;
    updateControls();
    try {
      if (!transfer) {
        const created = await uploadRequest(base, {
          method: 'POST', body: new URLSearchParams({ name: file.name, size: file.size }), signal
        });
        remember({ id: created.id, fingerprint: fingerprint(file), name: file.name, size: file.size });
        updateControls();
      }
      const url = `${base}/${transfer.id}`;
      let checkpoint = await uploadRequest(url, { signal });
      if (checkpoint.location) {
        remember(null);
        location.assign(checkpoint.location);
        return;
      }
      showProgress(checkpoint.offset);
      let retries = 0;
      while (checkpoint.offset < file.size) {
        try {
          const offset = checkpoint.offset;
          const next = await uploadRequest(url, {
            method: 'PATCH', body: file.slice(offset, offset + checkpoint.chunkSize),
            headers: { 'Upload-Offset': offset }, signal
          });
          checkpoint = { ...checkpoint, ...next };
          retries = 0;
          showProgress(checkpoint.offset);
        } catch (error) {
          if (signal.aborted || error.status && error.status !== 409 && error.status < 500 || retries >= 2) throw error;
          retries++;
          status.textContent = 'Paused, waiting for connection…';
          await new Promise((resolve) => setTimeout(resolve, retries * 800));
          checkpoint = await uploadRequest(url, { signal });
          if (checkpoint.location) {
            remember(null);
            location.assign(checkpoint.location);
            return;
          }
        }
      }

      status.textContent = 'Checking the video…';
      const result = await uploadRequest(`${url}/finish`, {
        method: 'POST', body: new URLSearchParams({ duplicate: allowDuplicate ? '1' : '0' }), signal
      });
      if (result.duplicate) {
        duplicate.hidden = false;
        existing.href = result.duplicate;
        status.textContent = 'An existing draft uses this file.';
      } else {
        remember(null);
        location.assign(result.location);
      }
    } catch (error) {
      if (!signal.aborted) {
        if (error.status === 404) remember(null);
        resume.textContent = transfer ? 'Resume upload' : 'Upload video';
        status.textContent = error.status ? error.message : 'Paused, waiting for connection. Resume when you’re online.';
      }
    } finally {
      if (current === controller) current = null;
      updateControls();
    }
  }

  async function discard(openExisting = false) {
    if (!transfer) return;
    current?.abort();
    const latest = transfer;
    const controller = new AbortController();
    current = controller;
    cancel.disabled = true;
    updateControls();
    try {
      await uploadRequest(`${base}/${latest.id}`, { method: 'DELETE', signal: controller.signal });
      remember(null);
      progress.hidden = true;
      duplicate.hidden = true;
      resume.textContent = 'Upload video';
      status.textContent = 'Upload cancelled.';
      if (openExisting) location.assign(existing.href);
    } catch (error) {
      if (error.status === 404) {
        remember(null);
        progress.hidden = duplicate.hidden = true;
        if (openExisting) location.assign(existing.href);
      }
      status.textContent = 'Could not cancel the upload. Try again.';
    } finally {
      if (current === controller) current = null;
      cancel.disabled = false;
      updateControls();
    }
  }

  input.addEventListener('change', () => selectFile(input.files[0]));
  zone.addEventListener('dragover', (event) => event.preventDefault());
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    selectFile(event.dataTransfer.files[0]);
  });
  resume.addEventListener('click', () => upload());
  cancel.addEventListener('click', () => discard());
  existing.addEventListener('click', (event) => { event.preventDefault(); discard(true); });
  anyway.addEventListener('click', () => upload(true));
  if (transfer) {
    status.textContent = `Choose ${transfer.name} again to resume the upload.`;
    resume.textContent = 'Resume upload';
  }
  updateControls();
}
