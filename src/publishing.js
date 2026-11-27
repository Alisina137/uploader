import { randomUUID } from 'node:crypto';
import { eligiblePlatforms, InputError } from './draft-model.js';
import { ayrshare, publishingKeys } from './partner.js';

export function platformCaption(video, platform) {
  const m = video.metadata;
  return m.delivery?.[platform]?.caption || [platform === 'YouTube' ? '' : video.title,
    m.description, m.hashtags.join(' '), m.captionFooters?.[platform]].filter(Boolean).join('\n\n') || video.title;
}

export function publishPayload(video, platform, options, rule, urls, mode) {
  if (!eligiblePlatforms(video.format).includes(platform)) throw new InputError(platform + ' requires a Short video.');
  const caption = platformCaption(video, platform);
  if (Array.from(caption).length > rule.caption_limit) throw new InputError(platform + ' caption exceeds ' + rule.caption_limit + ' characters.');
  const ratio = video.width / video.height;
  if (ratio + 0.002 < rule.min_ratio || ratio - 0.002 > rule.max_ratio) throw new InputError(platform + ' does not support this aspect ratio.');
  if (video.thumbnail_format && video.thumbnail_format !== video.format) throw new InputError('Update the thumbnail ratio in Details.');
  const visibility = video.metadata.visibility.toLowerCase();
  if (visibility === 'private' && ['Facebook','Instagram'].includes(platform)) throw new InputError(platform + ' cannot publish a private post. Change visibility or deselect it.');
  const payload = { post: caption, platforms: [platform.toLowerCase()], mediaUrls: [urls.media] };
  const thumb = urls.thumbnail ? { thumbNail: urls.thumbnail } : {};
  if (platform === 'YouTube') {
    if (Buffer.byteLength(caption) + (video.format === 'Short' ? 8 : 0) > 5000) throw new InputError('YouTube description exceeds its 5,000-byte limit including the Shorts label.');
    if (video.format === 'Short' && video.duration > 180) throw new InputError('YouTube Shorts must be at most three minutes.');
    if (!['yes','no'].includes(options.kids)) throw new InputError('Select the YouTube audience on Platforms.');
    payload.youTubeOptions = { title: video.title, visibility, tags: video.metadata.tags,
      madeForKids: options.kids === 'yes', shorts: video.format === 'Short', ...thumb };
    if (options.category) payload.youTubeOptions.categoryId = Number(options.category);
  }
  if (platform === 'Facebook') payload.faceBookOptions = { title: video.title, reels: video.format === 'Short', ...thumb };
  if (platform === 'Instagram') payload.instagramOptions = { reels: true, shareReelsFeed: !!options.grid, ...thumb };
  if (platform === 'TikTok') {
    if (!options.consent) throw new InputError('Review and accept the TikTok music usage confirmation on Platforms.');
    if (visibility === 'unlisted' && mode === 'direct') throw new InputError('Choose Public or Private for direct TikTok publishing.');
    if (visibility === 'private' && options.branded) throw new InputError('Branded TikTok content cannot be private.');
    payload.tikTokOptions = { draft: mode === 'draft', visibility: visibility === 'private' ? 'private' : 'public',
      isBrandedContent: !!options.branded, disableComments: !options.comments, disableDuet: !options.duet,
      disableStitch: !options.stitch, ...thumb };
  }
  return payload;
}

export function publishService(store, { partner = ayrshare(process.env.AYRSHARE_API_KEY),
  keys = publishingKeys(process.env.PUBLISH_SECRET), publicOrigin = process.env.PUBLIC_MEDIA_ORIGIN || '',
  enabled = Boolean(process.env.AYRSHARE_API_KEY), mode = process.env.TIKTOK_MODE === 'direct' ? 'direct' : 'draft' } = {}) {
  const data = store.publishing;
  const creating = new Map();
  const configured = Boolean(enabled && keys);
  function configuredOnly() {
    if (!configured) throw new InputError('Configure AYRSHARE_API_KEY and PUBLISH_SECRET on the server to connect accounts.', 503);
  }
  async function profile(folder) {
    configuredOnly();
    const saved = data.profile(folder.id);
    if (saved) return keys.open(saved.secret);
    if (!creating.has(folder.id)) {
      const work = partner.create(folder).then(async (key) => {
        try { data.putProfile(folder.id, keys.seal(key)); }
        catch (error) { await partner.remove(key); throw error; }
        return key;
      }).finally(() => creating.delete(folder.id));
      creating.set(folder.id, work);
    }
    return creating.get(folder.id);
  }

  async function refresh(folder) {
    configuredOnly();
    const saved = data.profile(folder.id);
    if (!saved) return {};
    const previous = JSON.parse(saved.accounts);
    const info = await partner.accounts(keys.open(saved.secret));
    const accounts = info.accounts;
    data.setAccounts(folder.id, accounts);
    for (const platform of new Set([...Object.keys(previous), ...Object.keys(accounts)])) {
      if (accounts[platform]) data.clearLink(folder.id, platform);
      if (accounts[platform] !== previous[platform]) data.event(folder.owner_id, folder.name, '', platform,
        accounts[platform] ? 'Connected' : 'Needs reconnect', accounts[platform] || 'Account is no longer linked.');
    }
    return info;
  }

  async function queue(owner, folder, video, selected, confirmation) {
    configuredOnly();
    if (!/^https:\/\//i.test(publicOrigin)) throw new InputError('Set PUBLIC_MEDIA_ORIGIN to the public HTTPS address of Upload Hub.', 503);
    if (!selected.length) throw new InputError('Select at least one connected platform.');
    const info = await refresh(folder);
    const accounts = info.accounts || {};
    if (info.monthlyCount + selected.length > info.monthlyLimit) throw new InputError('The publishing partner monthly quota is exhausted.',429);
    const current = store.getVideo(folder.id, video.id);
    if (!current || store.getChannel(owner.id, folder.id)?.archived !== 0 ||
        current.updated_at !== video.updated_at) throw new InputError('The draft changed. Reload Review before publishing.', 409);
    const rules = data.rules();
    const jobs = [...new Set(selected)].map((platform) => {
      const rule = rules.find((item) => item.platform === platform);
      if (!rule || !accounts[platform.toLowerCase()]) throw new InputError('Connect ' + platform + ' before publishing.');
      if (confirmation && confirmation.get('account-' + platform) !== accounts[platform.toLowerCase()]) {
        throw new InputError('The connected account changed. Review the account before publishing.',409);
      }
      if (platform === 'Instagram' && info.instagram?.type === 'personal') throw new InputError('Instagram requires a Business or Creator account.');
      if (platform === 'Instagram' && info.instagram?.usedQuota >= rule.daily_limit) throw new InputError('Instagram reports its rolling 24-hour cap is full. A slot opens as an earlier post ages out.',429);
      const settings = video.metadata.delivery?.[platform] || {};
      if (settings.selected === false) throw new InputError('Review the selected platforms before publishing.');
      const id = randomUUID();
      const base = '/delivery/' + id;
      const expires = Date.now() + 86400000;
      const image = video.thumbnail_format && store.getThumbnail(video.id);
      const urls = { media: keys.url(publicOrigin, base + (/\.mov$/i.test(video.filename) ? '/video.mov' : '/video.mp4'), expires),
        thumbnail: image && keys.url(publicOrigin, base + (image.mime === 'image/png' ? '/cover.png' : '/cover.jpg'), expires) };
      const payload = publishPayload(video, platform, settings, rule, urls, mode);
      return { id, platform, payload: { ...payload, idempotencyKey: id } };
    });
    data.reserve(owner.id, folder, video, jobs);
  }

  async function processRow(row) {
    if (!data.lease(row.id)) return;
    const payload = JSON.parse(row.payload);
    const attempts = row.attempts + 1;
    const record = (state, detail, id, delay = 0) => data.record(row, state, detail, id, attempts, delay);
    try {
      const key = keys.open(data.profile(row.channel_id).secret);
      const result = row.provider_id ? await partner.status(key, row.provider_id) : await partner.post(key, payload);
      const remote = result.postIds?.find((item) => item.platform === row.platform.toLowerCase());
      const id = result.id || row.provider_id;
      if (remote?.status === 'error' || result.status === 'error') {
        return record('Failed', remote?.message || result.errors?.[0]?.message || result.message || 'The partner rejected this target.', id);
      }
      if (remote?.status === 'success' && remote.id && remote.id !== 'pending' && remote.postUrl !== 'pending' && (!payload.tikTokOptions?.draft || /^https:\/\//.test(remote.postUrl || ''))) {
        return record('Published', 'Confirmed by the platform.', id);
      }
      if (payload.tikTokOptions?.draft && id && result.status === 'success') {
        return record('Needs manual action', 'Open TikTok Inbox and finish posting the draft.', id, 300000);
      }
      if (id) return record('Publishing', 'Waiting for platform confirmation.', id, 30000);
      return record('Check status', 'Check the partner dashboard before submitting this video again.', null);
    } catch (error) {
      if (row.provider_id) return record('Publishing', 'Status check unavailable. Checking again shortly.', row.provider_id, 60000);
      if ((error.status === 503 || error.status === 429) && attempts < 3) {
        return record('Queued', 'Partner unavailable. Retrying shortly.', null, attempts * 15000);
      }
      const uncertain = error.duplicate || !error.status || error.status >= 500;
      return record(uncertain ? 'Check status' : 'Failed', error.message, error.providerId || null);
    }
  }
  return { configured, mode, keys, partner, profile, refresh, queue,
    async remove(folder) {
      if (creating.has(folder.id)) await creating.get(folder.id);
      const saved = data.profile(folder.id);
      if (saved) {
        configuredOnly();
        await partner.remove(keys.open(saved.secret));
        data.forgetProfile(folder.id);
      }
    },
    async tick() { if (configured) await Promise.all(data.ready().map(processRow)); }
  };
}
