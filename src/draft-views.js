import { eligiblePlatforms, formats, initialMetadata, maxFileSize, platforms, suggestedFormat, visibilities } from './draft-model.js';
import { escape as e, icon, shell, textField } from './views.js';

export const folderPath = (id) => `/channels/${id}`;
export const videoPath = (folder, id) => `${folderPath(folder)}/videos/${id}`;
const folderVideos = (folder) => `${folderPath(folder.id)}/videos`;
const stages = [['details', 'Details'], ['platforms', 'Platforms'], ['review', 'Review']];

const notice = (error) => error ? `<p class="notice error" role="alert" tabindex="-1" data-focus>${e(error)}</p>` : '';
const submit = (label) => `<button class="primary">${label}</button>`;
const select = (name, label, options, current) => `<div class="field"><label for="${name}">${label}</label>
  <select id="${name}" name="${name}">${options.map(([value, title]) =>
    `<option value="${e(value)}" ${value === current ? 'selected' : ''}>${e(title)}</option>`).join('')}</select></div>`;
const text = (name, label, value, limit, hint) =>
  textField({ name, label, value, limit, hint, autocomplete: 'off' });
const optionalText = (name, label, value, max, type = 'text') => `<div class="field">
  <label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${e(value)}"
    maxlength="${max}"></div>`;
const chipField = (name, label, values, max) => `<div data-chip-field>
  ${optionalText(name, label, values.join(', '), max)}
  <div class="badges" data-chips></div></div>`;
const textarea = (name, label, value, max) => `<div class="field"><label for="${name}">${label}</label>
  <textarea id="${name}" name="${name}" rows="4" maxlength="${max}">${e(value)}</textarea></div>`;
const time = (stamp, zone) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short', timeZone: zone || 'UTC'
}).format(stamp);
const badges = (format) => eligiblePlatforms(format).map((platform) => `<span class="badge">${platform}</span>`).join('');

function workspace(owner, title, body) {
  return shell({ title: e(title), path: '/channels', owner, body });
}

function folderShell(owner, folder, tab, content) {
  const base = folderPath(folder.id);
  const tabs = [['videos', 'Videos'], ['defaults', 'Defaults'], ['settings', 'Settings']];
  return workspace(owner, folder.name, `<a class="breadcrumb" href="/channels">← Channels</a>
    <div class="page-heading"><h1>${e(folder.name)}</h1>${folder.archived ? '<span class="badge">Archived</span>' : ''}</div>
    <nav class="subtabs" aria-label="Channel">${tabs.map(([route, label]) =>
      `<a href="${base}/${route}" ${tab === route ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>${content}`);
}

function newFolder(action, value, error) {
  return `<form class="card studio-form" method="post" action="${action}">${notice(error)}
    ${text('name', 'Folder name', value, 40)}<div class="form-actions">${submit('Create folder')}</div></form>`;
}

export function onboardingView(owner, value = '', error) {
  return workspace(owner, 'Create your first channel folder', `<h1>Create your first channel folder</h1>
    <p class="intro">A folder keeps the videos and defaults for one channel together.</p>
    ${newFolder('/onboarding', value, error)}
    <form method="post" action="/onboarding"><button class="plain-button" name="intent" value="skip">Skip for now</button></form>`);
}

export function channelsView(owner, folders, { query, archived, create = false, value = '', error }) {
  const filters = `<form class="list-filters" action="/channels" data-list-filter>
    ${optionalText('q', 'Search folders', query, 100)}${archived ? '<input type="hidden" name="archived" value="1">' : ''}
    <button class="plain-button">Search</button></form>`;
  const empty = query ? `<p>No folders match your search.</p><a href="/channels${archived ? '?archived=1' : ''}">Clear search</a>`
    : archived ? '<p>No archived channel folders.</p>' : '<p>No channel folders yet.</p><a href="/channels?new=1">Create a folder</a>';
  return workspace(owner, 'Channels', `<div class="page-heading"><h1>Channels</h1>
    <a class="primary" href="/channels?new=1">New channel folder</a></div>
    ${create ? newFolder('/channels', value, error) : ''}
    <nav class="subtabs" aria-label="Folder status"><a href="/channels" ${archived ? '' : 'aria-current="page"'}>Active</a>
    <a href="/channels?archived=1" ${archived ? 'aria-current="page"' : ''}>Archived</a></nav>
    ${filters}<div data-list-results>
    ${folders.length ? `<div class="folder-grid">${folders.map((folder) => `<a class="card folder-card" href="${folderVideos(folder)}">
      <span class="empty-icon">${icon('channels')}</span><h2>${e(folder.name)}</h2>
      <p>${folder.drafts} ${folder.drafts === 1 ? 'draft' : 'drafts'}</p></a>`).join('')}</div>`
    : `<div class="card empty-state"><span class="empty-icon">${icon('channels')}</span>${empty}</div>`}</div>`);
}

export function videosView(owner, folder, listing, filters, destinations, error) {
  const base = folderVideos(folder);
  const { query, format, order } = filters;
  const pageLink = (page) => `${base}?${e(new URLSearchParams({ q: query, format, order, page }).toString())}`;
  return folderShell(owner, folder, 'videos', `<div class="page-heading"><h2>Videos</h2>
    ${folder.archived ? '' : `<a class="primary" href="${base}/new">Upload video</a>`}</div>
    ${notice(error)}
    <details class="filter-panel" data-filter-panel><summary>Filter videos</summary>
      <form class="list-filters" action="${base}" data-list-filter data-video-list>
      ${optionalText('q', 'Search by title', query, 100)}
      ${select('format', 'Format', [['', 'All formats'], ...formats.map((item) => [item, item])], format)}
      ${select('order', 'Sort by', [['updated', 'Last updated'], ['title', 'Title']], order)}
      <button class="plain-button">Apply filters</button></form></details>
    <div data-list-results>${listing.rows.length ? `<div class="video-list">${listing.rows.map((video) => {
    const url = videoPath(folder.id, video.id);
    return `<article class="card video-row">${video.thumbnail_format ? `<img src="${url}/thumbnail" alt="">`
      : `<span class="video-placeholder" aria-hidden="true">${icon('logo')}</span>`}
      <div class="video-summary"><h3><a href="${url}/details">${e(video.title)}</a></h3>
      <div class="badges"><span class="badge ${video.format.toLowerCase()}">${video.format}</span><span class="badge">Draft</span>${badges(video.format)}</div>
      <p class="hint">Updated ${e(time(video.updated_at, owner.time_zone))}</p></div>
      ${folder.archived ? '' : `<details class="video-actions"><summary>Actions</summary><div>
        <a href="${url}/details">Edit draft</a>
        <form method="post" action="${url}/actions"><button class="plain-button" name="intent" value="duplicate">Duplicate</button></form>
        ${destinations.length ? `<form method="post" action="${url}/actions">
          <label>Move to <select name="destination" required><option value="">Choose folder</option>
          ${destinations.map((item) => `<option value="${item.id}">${e(item.name)}</option>`).join('')}</select></label>
          <button class="plain-button" name="intent" value="move">Move draft</button></form>` : ''}
        <a class="danger-link" href="${url}/delete">Delete draft</a>
      </div></details>`}</article>`;
  }).join('')}</div>` : `<div class="card empty-state">${query || format
    ? `<p>No videos match your filters.</p><a href="${base}">Clear filters</a>`
    : `<p>This folder has no videos.</p>${folder.archived ? '' : `<a href="${base}/new">Upload a video</a>`}`}</div>`}
    ${listing.pages > 1 ? `<nav class="pagination" aria-label="Pages">${listing.page > 1 ? `<a href="${pageLink(listing.page - 1)}">Previous</a>` : ''}
      <span>Page ${listing.page} of ${listing.pages}</span>${listing.page < listing.pages ? `<a href="${pageLink(listing.page + 1)}">Next</a>` : ''}</nav>` : ''}</div>`);
}

export function defaultsView(owner, folder, error, saved, values = initialMetadata(folder.defaults)) {
  return folderShell(owner, folder, 'defaults', `<h2>Draft defaults</h2><p class="intro">These values are copied when you add a video.</p>
    <form class="card studio-form" method="post" action="${folderPath(folder.id)}/defaults">${notice(error)}
    ${saved ? '<p class="notice success" role="status">Defaults saved.</p>' : ''}
    <fieldset ${folder.archived ? 'disabled' : ''}>${textarea('description', 'Description footer', values.description, 5000)}
    ${chipField('hashtags', 'Hashtags (comma-separated)', values.hashtags, 3100)}
    ${chipField('tags', 'YouTube tags (comma-separated)', values.tags, 550)}
    ${select('visibility', 'Visibility', visibilities.map((item) => [item, item]), values.visibility)}
    ${platforms.map((item) => textarea(item, item + ' caption footer', values.captionFooters[item] || '', 2000)).join('')}
    ${optionalText('preferredTime', 'Preferred time for future schedules', values.preferredTime, 5, 'time')}</fieldset>
    ${folder.archived ? '' : `<div class="form-actions">${submit('Save defaults')}</div>`}</form>`);
}

export function folderSettingsView(owner, folder, error, value = folder.name) {
  const action = `${folderPath(folder.id)}/settings`;
  return folderShell(owner, folder, 'settings', `<h2>Folder settings</h2>
    ${folder.archived ? '' : `<form class="card studio-form" method="post" action="${action}">
      ${text('name', 'Folder name', value, 40)}<div class="form-actions"><button class="primary" name="intent" value="rename">Rename folder</button></div></form>`}
    <section class="card studio-form"><h3>${folder.archived ? 'Restore folder' : 'Archive folder'}</h3>
      <p>${folder.archived ? 'Restore the folder to edit its videos and defaults.' : 'Archiving keeps the folder and its drafts available to view.'}</p>
      <form method="post" action="${action}"><button class="plain-button" name="intent" value="${folder.archived ? 'restore' : 'archive'}">
        ${folder.archived ? 'Restore folder' : 'Archive folder'}</button></form></section>
    <form class="card studio-form" method="post" action="${action}"><h3>Delete folder</h3>${notice(error)}
      <p>This permanently deletes the folder, its drafts, and unshared source files from Upload Hub. Posts on platforms stay online.</p>
      ${text('confirmation', `Type “${e(folder.name)}” to confirm`, '', 40)}
      <div class="form-actions"><button class="plain-button danger-link" name="intent" value="delete">Delete folder</button></div></form>`);
}

export function uploadView(owner, folder) {
  const base = folderVideos(folder);
  return folderShell(owner, folder, 'videos', `<a class="breadcrumb" data-videos-back href="${base}">← Videos</a><h2>Upload video</h2>
    <section class="card studio-form" data-upload="${base}/uploads">
      <label class="dropzone" for="file"><strong>Choose or drop a video</strong><span>MP4 or MOV, up to ${maxFileSize / 1024 ** 3} GB</span>
      <input id="file" type="file" accept=".mp4,.mov,video/mp4,video/quicktime"></label>
      <progress max="100" value="0" hidden aria-label="Video upload"></progress>
      <p role="status" data-upload-status></p>
      <div class="form-actions">
        <button type="button" class="primary" data-resume disabled>Upload video</button>
        <button type="button" class="plain-button" data-cancel hidden>Cancel upload</button>
      </div>
      <div class="notice" data-duplicate hidden>
        <p>Already uploaded. Open it or upload anyway?</p>
        <div class="form-actions"><a data-existing href="${base}">Open existing draft</a>
        <button class="plain-button" type="button" data-anyway>Upload anyway</button></div>
      </div>
      <noscript>Enable JavaScript to upload and resume video files.</noscript>
    </section>`);
}

function mediaEditor(video, url, archived) {
  return `<section class="card studio-form" data-thumbnail-editor="${url}/thumbnail">
    <h3>Thumbnail</h3><p class="hint">Use a JPG or PNG under 2 MB. Choose 9:16 for Short or 16:9 for Long.</p>
    <img class="draft-thumbnail" alt="Draft thumbnail" data-thumbnail ${video.thumbnail_format ? `src="${url}/thumbnail"` : 'hidden'}>
    ${archived ? '' : `<label class="field">Upload thumbnail<input type="file" accept="image/jpeg,image/png" data-thumbnail-file></label>
      <details><summary>Pick a frame</summary><video class="source-preview" controls preload="none" aria-label="Source video preview" src="${url}/source"></video>
      <p class="hint" data-preview-error hidden>This browser cannot play the source. Enter a time to choose a frame.</p>
      <label class="field">Time in seconds<input type="number" min="0" max="${video.duration}" step="0.01" value="0" data-frame-time></label>
      <button type="button" class="plain-button" data-pick-frame>Use this frame</button></details>
      <button type="button" class="plain-button danger-link" data-remove-thumbnail ${video.thumbnail_format ? '' : 'hidden'}>Remove thumbnail</button>
      <p role="status" data-thumbnail-status></p>`}</section>`;
}

function detailsView(video, url, archived) {
  const metadata = video.metadata;
  const suggestion = suggestedFormat(video);
  return `<div class="draft-editor-grid"><form class="card studio-form" method="post" action="${url}/details" data-draft-details>
    <p class="source-facts"><strong>${e(video.filename)}</strong> <span>${Math.round(video.duration)} s · ${video.width} × ${video.height}</span></p>
    <fieldset class="format-picker" ${archived ? 'disabled' : ''}><legend>Format</legend>
      <div>${formats.map((format) => `<label><input type="radio" name="format" value="${format}" ${video.format === format ? 'checked' : ''}>
        <span>${format}</span></label>`).join('')}</div>
      <p class="hint">Suggested format is ${suggestion}.</p>
      <p class="format-warning" data-suggested="${suggestion}" ${suggestion === video.format ? 'hidden' : ''}>
        The selected format differs from the suggestion for this video.</p></fieldset>
    <fieldset ${archived ? 'disabled' : ''}>
    ${text('title', 'Title', video.title, 100)}<p class="hint" data-title-count>${video.title.length}/100 characters</p>
    ${textarea('description', 'Description', metadata.description, 5000)}
    ${chipField('hashtags', 'Hashtags (comma-separated)', metadata.hashtags, 3100)}
    ${chipField('tags', 'YouTube tags (comma-separated)', metadata.tags, 550)}
    ${select('visibility', 'Visibility', visibilities.map((item) => [item, item]), metadata.visibility)}
    <p class="hint">Unlisted is available on YouTube. A Facebook post with this setting is Page-visible.</p></fieldset>
    ${archived ? '' : `<div class="form-actions">${submit('Continue to Platforms')}<p role="status" data-autosave></p></div>`}
    </form>${mediaEditor(video, url, archived)}</div>`;
}

function platformsView(video, url) {
  const eligible = eligiblePlatforms(video.format);
  return `<section class="card studio-form"><h3>Platform eligibility</h3><p class="intro">${video.format} video</p>
    <ul class="eligibility-list">${platforms.map((platform) => `<li><strong>${platform}</strong>
    <span class="badge ${eligible.includes(platform) ? 'short' : ''}">${eligible.includes(platform) ? 'Eligible' : 'Short videos only'}</span></li>`).join('')}</ul>
    <div class="form-actions"><a class="plain-button" href="${url}/details">Back to Details</a>
    <a class="primary" href="${url}/review">Continue to Review</a></div></section>`;
}

function reviewView(video, url, archived) {
  const metadata = video.metadata;
  return `<section class="card studio-form"><h3>${e(video.title)}</h3>
    <div class="badges"><span class="badge ${video.format.toLowerCase()}">${video.format}</span><span class="badge">${metadata.visibility}</span></div>
    ${video.thumbnail_format && video.thumbnail_format === video.format ? `<img class="draft-thumbnail" src="${url}/thumbnail" alt="Draft thumbnail">` : ''}
    ${metadata.description ? `<p class="caption-preview">${e(metadata.description)}</p>` : ''}
    ${metadata.hashtags.length ? `<p>${e(metadata.hashtags.join(' '))}</p>` : ''}
    ${metadata.tags.length ? `<p class="hint">YouTube tags · ${e(metadata.tags.join(', '))}</p>` : ''}
    <ul class="eligibility-list">${eligiblePlatforms(video.format).map((platform) => {
      const caption = [platform === 'Instagram' || platform === 'TikTok' ? video.title : '',
        metadata.description, metadata.hashtags.join(' '), metadata.captionFooters[platform]].filter(Boolean).join('\n\n');
      let visibility = metadata.visibility;
      if (visibility === 'Unlisted' && platform !== 'YouTube') {
        visibility = platform === 'Facebook' ? 'Page-visible' : 'Set when publishing';
      }
      return `<li><div><strong>${platform}</strong>${caption ? `<p class="caption-preview hint">${e(caption)}</p>` : ''}</div>
        <span class="badge">${visibility}</span></li>`;
    }).join('')}</ul>
    ${!archived && video.thumbnail_format && video.thumbnail_format !== video.format
      ? '<p class="notice error">The thumbnail ratio differs from the selected format. Update or remove it in Details.</p>' : ''}
    <div class="form-actions"><a class="plain-button" href="${url}/platforms">Back to Platforms</a>
    ${archived ? '' : `<form method="post" action="${url}/review">${submit('Save draft')}</form>`}</div></section>`;
}

export function editorView(owner, folder, video, step, error) {
  const url = videoPath(folder.id, video.id);
  let content;
  if (step === 'details') content = detailsView(video, url, folder.archived);
  if (step === 'platforms') content = platformsView(video, url);
  if (step === 'review') content = reviewView(video, url, folder.archived);
  return folderShell(owner, folder, 'videos', `<a class="breadcrumb" data-videos-back href="${folderVideos(folder)}">← Videos</a>
    <h2>${folder.archived ? 'View draft' : 'Edit draft'}</h2>
    <nav class="subtabs" aria-label="Draft steps" data-draft-steps>${stages.map(([route, title]) =>
      `<a href="${url}/${route}" ${step === route ? 'aria-current="step"' : ''}>${title}</a>`).join('')}</nav>
    ${notice(error)}${content}`);
}

export function deleteVideoView(owner, folder, video) {
  const url = videoPath(folder.id, video.id);
  return folderShell(owner, folder, 'videos', `<form class="card studio-form" method="post" action="${url}/actions">
    <h2>Delete draft</h2><p>Delete “${e(video.title)}” from Upload Hub? Existing posts on platforms stay online.</p>
    <div class="form-actions"><a class="plain-button" data-videos-back href="${folderVideos(folder)}">Cancel</a>
      <button class="plain-button danger-link" name="intent" value="delete">Delete draft</button></div></form>`);
}
