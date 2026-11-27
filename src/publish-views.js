import { escape as e, shell } from './views.js';
import { platforms, eligiblePlatforms } from './draft-model.js';
import { platformCaption, publishPayload } from './publishing.js';

const checked = (value) => value ? 'checked' : '';
const requirements = {
  YouTube: 'Connect the YouTube channel you want to publish to.',
  Facebook: 'Connect a Facebook Page you administer.',
  Instagram: 'Use a Business or Creator account linked to a Facebook Page. Personal accounts cannot publish through this integration.',
  TikTok: 'Connect the account that will receive your videos.'
};

export function accountsBody(folder, context, links, message) {
  const base = '/channels/' + folder.id + '/accounts';
  return `<h2>Accounts</h2><div data-account-refresh>
    ${message ? `<p class="notice error" role="alert">${e(message)}</p>` : ''}
    ${!context.configured ? '<p class="notice">Set AYRSHARE_API_KEY and PUBLISH_SECRET in the server environment to enable connections.</p>' : ''}
    ${platforms.map((platform) => {
      const account = context.accounts[platform.toLowerCase()];
      const link = links.find((item) => item.platform === platform);
      const expired = link && link.expires <= Date.now();
      return `<section class="card studio-form"><div class="page-heading"><h3>${platform}</h3>
        <span class="badge">${account ? 'Connected' : expired ? 'Link expired' : link ? 'Awaiting approval' : 'Not connected'}</span></div>
        <p>${account ? e(account) : requirements[platform]}</p>
        ${context.configured && !folder.archived ? account
          ? `<details><summary>Disconnect account</summary><p>Existing posts on the platform stay online.</p>
             <form method="post" action="${base}"><input type="hidden" name="platform" value="${platform}">
             <button class="plain-button" name="intent" value="disconnect">Confirm disconnect</button></form></details>`
          : `<form method="post" action="${base}" target="_blank" rel="noopener"><input type="hidden" name="platform" value="${platform}">
             <button class="primary" name="intent" value="connect">${link ? 'Try again' : 'Connect'} ${platform}</button></form>` : ''}
        </section>`;
    }).join('')}<a class="plain-button" href="${base}">Refresh accounts</a></div>`;
}

function toggle(name, label, value) {
  return `<label><input type="checkbox" name="${name}" ${checked(value)}> ${label}</label>`;
}
export function platformSettings(video, url, context, archived) {
  const eligible = eligiblePlatforms(video.format);
  return `<form class="studio-form card" method="post" action="${url}/platforms"><h3>Publishing settings</h3>
    ${platforms.map((platform) => {
      const options = video.metadata.delivery?.[platform] || {};
      const account = context.accounts[platform.toLowerCase()];
      const available = eligible.includes(platform);
      return `<fieldset ${archived || !available ? 'disabled' : ''}><legend>${platform}</legend>
        ${available ? (account ? toggle(platform, 'Publish to ' + e(account), options.selected !== false)
          : `<a href="/channels/${video.channel_id}/accounts">Connect to enable ${platform}</a>`) : '<span>Short videos only</span>'}
        ${available ? `<label class="field">Caption override<textarea name="${platform}-caption" maxlength="10000">${e(options.caption || '')}</textarea></label>` : ''}
        ${platform === 'YouTube' ? `<label>Audience <select name="kids"><option value="">Choose audience</option>
          <option value="yes" ${options.kids === 'yes' ? 'selected' : ''}>Made for kids</option><option value="no" ${options.kids === 'no' ? 'selected' : ''}>Not made for kids</option></select></label>
          <label class="field">Category ID (optional)<input type="number" min="1" max="99" name="category" value="${e(options.category || '')}"></label>` : ''}
        ${platform === 'Instagram' ? toggle('grid','Show on profile grid',options.grid) : ''}
        ${platform === 'TikTok' ? `<p>${context.mode === 'draft' ? 'Draft mode · Finish posting in TikTok Inbox.' : 'Direct publishing mode'}</p>
          ${toggle('comments','Allow comments',options.comments)}${toggle('duet','Allow Duet',options.duet)}${toggle('stitch','Allow Stitch',options.stitch)}
          ${toggle('branded','Paid partnership / branded content',options.branded)}
          ${toggle('consent','I agree to TikTok’s Music Usage Confirmation and hold the rights to use this audio.',options.consent)}` : ''}
        </fieldset>`;
    }).join('')}${archived ? '' : '<button class="primary">Save platforms and review</button>'}</form>`;
}

export function publishReview(video, url, context) {
  const targets = context.targets || [];
  const eligible = eligiblePlatforms(video.format);
  return `<form class="studio-form card" method="post" action="${url}/publish"><h3>Publish now</h3><input type="hidden" name="revision" value="${video.updated_at}">
    ${eligible.map((platform) => {
      const account = context.accounts[platform.toLowerCase()];
      const options = video.metadata.delivery?.[platform] || {};
      const target = targets.find((row) => row.platform === platform);
      let issue = '';
      try { publishPayload(video, platform, options, context.rules.find((rule) => rule.platform === platform), {}, context.mode); }
      catch (error) { issue = error.message; }
      const locked = target && target.state !== 'Failed';
      return `<div><input type="hidden" name="account-${platform}" value="${e(account || '')}"><label><input type="checkbox" name="platform" value="${platform}"
        ${!account || issue || locked || options.selected === false ? 'disabled' : 'checked'}> ${platform}${account ? ' · ' + e(account) : ''}</label>
        ${target ? `<p class="hint">${e(target.state)} · ${e(target.detail)}</p>` : ''}
        ${!account ? `<a href="/channels/${video.channel_id}/accounts">Connect to enable</a>` : ''}
        ${issue ? `<p class="field-error">${e(issue)}</p>` : ''}
        ${options.caption ? `<p class="caption-preview">${e(platformCaption(video,platform))}</p>` : ''}</div>`;
    }).join('')}
    <button class="primary" ${context.configured ? '' : 'disabled'}>Confirm and publish</button></form>`;
}

export function activityPage(owner, events, filter) {
  const filters = ['', 'Publishing', 'Published', 'Failed', 'Needs manual action', 'Check status'];
  const columns = ['Time', 'Channel', 'Video', 'Platform', 'Result', 'Details'];
  const row = (item) => {
    const date = new Date(item.created).toLocaleString('en', { timeZone: owner.time_zone || 'UTC', timeZoneName:'short' });
    const values = [e(date), e(item.channel), e(item.title || '—'), e(item.platform),
      `<span class="badge">${e(item.state)}</span>`,
      e(item.detail) + (item.retry ? `<form method="post" action="/activity/retry"><button class="plain-button" name="id" value="${item.target}">Retry ${e(item.platform)}</button></form>` : '')];
    return '<tr>' + values.map((value,index) => `<td data-label="${columns[index]}">${value}</td>`).join('') + '</tr>';
  };
  return shell({ owner, title: 'Activity', path: '/activity', body: `<h1>Activity</h1>
    <form class="list-filters" action="/activity"><label class="field">Result <select name="state">${filters.map((item) =>
      `<option value="${item}" ${item === filter ? 'selected' : ''}>${item || 'All'}</option>`).join('')}</select></label>
    <button class="plain-button">Filter</button></form>
    ${events.length ? `<table class="activity-table"><caption class="hint">Latest activity</caption><thead><tr>
      ${columns.map((name)=>`<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>${events.map(row).join('')}</tbody></table>`
      : '<div class="card empty-state">No matching activity yet.</div>'}
    <a class="plain-button" href="/activity">Refresh activity</a>` });
}
