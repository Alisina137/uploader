import { chunkSize, channelName, platforms, defaultsFrom, formats, InputError, maxFileSize,
  maxThumbnailSize, videoDetailsFrom } from './draft-model.js';
import { channelsView, defaultsView, deleteVideoView, editorView, folderPath, folderSettingsView,
  onboardingView, uploadView, videoPath, videosView } from './draft-views.js';
import { json, readBody, readForm, redirect, send } from './http.js';
import { thumbnailFrom } from './media.js';
import { messageView } from './views.js';

const idPattern = '[a-f0-9-]{36}';
const folderRoute = new RegExp(`^/channels/(${idPattern})(?:/(.*))?$`);
const draftRoute = new RegExp(`^videos/(${idPattern})/(details|platforms|review|publish|actions|delete|thumbnail|source)$`);
const transferRoute = new RegExp(`^videos/uploads(?:/(${idPattern})(/finish)?)?$`);

async function formBody(request) {
  const form = await readForm(request, 128 * 1024);
  if (!form) throw new InputError('Submit the form again.', 400);
  return form;
}

const apiRequest = (request) => request.headers.accept === 'application/json';

export function draftRoutes(store, media, publishing, publishRoutes) {
  function requireEditable(owner, id) {
    const current = store.getChannel(owner.id, id);
    if (!current || current.archived) throw new InputError('Restore this folder before editing its drafts.', 409);
    return current;
  }

  async function channelList(request, response, url, owner) {
    const onboard = url.pathname === '/onboarding';
    if (onboard && owner.onboarded) return redirect(response, '/channels');
    const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const archived = Number(url.searchParams.get('archived') === '1');
    function view(status, value, error) {
      const list = () => store.listChannels(owner.id, query, archived);
      return send(response, status, onboard ? onboardingView(owner, value, error) : channelsView(owner, list(), {
        query, archived, value, error, create: Boolean(error) || url.searchParams.has('new')
      }));
    }
    if (request.method === 'GET') return view(200);
    if (request.method !== 'POST') throw new InputError('This page is unavailable.', 404);
    const form = await formBody(request);
    if (onboard && form.get('intent') === 'skip') {
      store.skipOnboarding(owner.id);
      return redirect(response, '/channels');
    }
    try {
      const id = store.createChannel(owner.id, channelName(form.get('name')));
      if (publishing.configured) await publishing.profile(store.getChannel(owner.id,id));
      return redirect(response, `${folderPath(id)}/videos`);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      return view(error.status, form.get('name'), error.message);
    }
  }

  function showVideos(response, url, owner, folder, error) {
    const format = url.searchParams.get('format');
    const filters = {
      query: (url.searchParams.get('q') || '').trim().slice(0, 100),
      status: url.searchParams.get('status') || '',
      format: formats.includes(format) ? format : '',
      order: url.searchParams.get('order') === 'title' ? 'title' : 'updated',
      page: Math.max(1, Number.parseInt(url.searchParams.get('page'), 10) || 1)
    };
    const destinations = store.listChannels(owner.id).filter((item) => item.id !== folder.id);
    const listing = store.listVideos(folder.id, filters);
    for (const video of listing.rows) video.targets = store.publishing.targets(video.id);
    return send(response, error ? error.status : 200, videosView(owner, folder, listing, filters, destinations, error?.message));
  }

  async function folderSettings(request, response, owner, folder) {
    if (request.method === 'GET') return send(response, 200, folderSettingsView(owner, folder));
    if (request.method !== 'POST') throw new InputError('This page is unavailable.', 404);
    const form = await formBody(request);
    const current = store.getChannel(owner.id, folder.id);
    if (!current) throw new InputError('The folder is unavailable.', 404);
    const intent = form.get('intent');
    try {
      if (intent === 'delete') {
        if (form.get('confirmation') !== current.name) throw new InputError('Type the exact folder name to delete it.');
        if (store.publishing.activeFolder(folder.id)) throw new InputError('Wait for the pending publication to finish.',409);
        await publishing.remove(current);
        for (const key of store.deleteChannel(owner.id, folder.id)) media.removeUnused(key);
        return redirect(response, current.archived ? '/channels?archived=1' : '/channels');
      }
      if (intent === 'archive' || intent === 'restore') store.archiveChannel(owner.id, folder.id, Number(intent === 'archive'));
      else if (intent === 'rename') {
        requireEditable(owner, folder.id);
        store.renameChannel(owner.id, folder.id, channelName(form.get('name')));
      } else throw new InputError('Choose a folder action.');
      return redirect(response, `${folderPath(folder.id)}/settings`);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      return send(response, error.status, folderSettingsView(owner, current, error.message, form.get('name') || current.name));
    }
  }

  async function folderDefaults(request, response, owner, folder) {
    if (request.method === 'GET') return send(response, 200, defaultsView(owner, folder));
    if (request.method !== 'POST') throw new InputError('This page is unavailable.', 404);
    const form = await formBody(request);
    const current = requireEditable(owner, folder.id);
    try {
      const defaults = defaultsFrom(form);
      store.saveDefaults(owner.id, folder.id, defaults);
      return send(response, 200, defaultsView(owner, { ...current, defaults }, null, true));
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      const values = {
        description: form.get('description') || '', visibility: form.get('visibility'),
        hashtags: [form.get('hashtags') || ''], tags: [form.get('tags') || ''],
        captionFooters: Object.fromEntries(form), preferredTime: form.get('preferredTime') || ''
      };
      return send(response, error.status, defaultsView(owner, current, error.message, false, values));
    }
  }

  async function upload(request, response, owner, folder, id, finish) {
    const channel = folder.id;
    requireEditable(owner, channel);
    if (!id && request.method === 'POST') {
      const form = await formBody(request);
      const filename = (form.get('name') || '').trim().normalize('NFC');
      const size = Number(form.get('size'));
      if (!/^.{1,245}\.(mp4|mov)$/i.test(filename) || /[\/\\\p{Cc}]/u.test(filename)) {
        throw new InputError('Choose an MP4 or MOV video file.');
      }
      if (!Number.isSafeInteger(size) || size <= 0 || size > maxFileSize) throw new InputError('Choose a video up to 2 GB.');
      requireEditable(owner, channel);
      return json(response, 201, { id: store.createUpload(channel, filename, size), chunkSize });
    }
    if (!id) throw new InputError('This upload is unavailable.', 404);
    const current = store.getUpload(channel, id);
    if (!current) {
      if ((request.method === 'GET' || finish) && store.getVideo(channel, id)) {
        return json(response, 200, { location: `${videoPath(channel, id)}/details` });
      }
      throw new InputError('This upload is unavailable. Select the file to start again.', 404);
    }
    if (!finish && request.method === 'GET') return json(response, 200, { offset: media.offset(id), chunkSize });
    if (!finish && request.method === 'DELETE') {
      store.deleteUpload(id);
      media.removeUnused(id);
      return json(response, 200, {});
    }
    if (!finish && request.method === 'PATCH') {
      const offset = Number(request.headers['upload-offset']);
      const data = await readBody(request, chunkSize);
      requireEditable(owner, channel);
      if (!store.getUpload(channel, id)) throw new InputError('This upload is no longer available.', 409);
      return json(response, 200, { offset: media.append(current, offset, data) });
    }
    if (finish && request.method === 'POST') {
      const form = await formBody(request);
      const result = await media.finalize(current,
        (metadata) => store.finalizeUpload(owner.id, current, metadata, form.get('duplicate') === '1'));
      return result.duplicate ? json(response, 409, { duplicate: `${videoPath(channel, result.duplicate)}/details` })
        : json(response, 200, { location: `${videoPath(channel, result.id)}/details` });
    }
    throw new InputError('This upload is unavailable.', 404);
  }

  async function thumbnail(request, response, video, owner) {
    if (request.method === 'GET') {
      const image = store.getThumbnail(video.id);
      if (!image) throw new InputError('This thumbnail is unavailable.', 404);
      response.writeHead(200, { 'Content-Type': image.mime });
      return response.end(image.data);
    }
    requireEditable(owner, video.channel_id);
    if (store.publishing.targets(video.id).some((row) => ['Publishing','Queued'].includes(row.state))) throw new InputError('Wait for the pending publication before changing its thumbnail.',409);
    if (request.method === 'DELETE') {
      store.deleteThumbnail(video.id);
      return json(response, 200, {});
    }
    if (request.method !== 'POST') throw new InputError('This thumbnail is unavailable.', 404);
    let image;
    if (request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
      const form = await formBody(request);
      const value = form.get('seconds');
      const seconds = value?.trim() ? Number(value) : NaN;
      if (!Number.isFinite(seconds) || seconds < 0 || seconds >= video.duration) {
        throw new InputError('Choose a time within the video.');
      }
      image = await media.frame(video, seconds);
    } else {
      image = await thumbnailFrom(await readBody(request, maxThumbnailSize), video.format);
    }
    requireEditable(owner, video.channel_id);
    if (store.getVideo(video.channel_id, video.id)?.format !== video.format) {
      throw new InputError('The draft changed. Reload it and try again.', 409);
    }
    store.saveThumbnail(video.id, image);
    return json(response, 200, {});
  }

  async function videoEditor(request, response, url, owner, folder, id, step) {
    const video = store.getVideo(folder.id, id);
    if (!video) throw new InputError('This draft is unavailable.', 404);
    if (step === 'thumbnail') return thumbnail(request, response, video, owner);
    if (request.method === 'GET') {
      if (step === 'source') return media.stream(video, request, response);
      if (step === 'delete') {
        requireEditable(owner, folder.id);
        return send(response, 200, deleteVideoView(owner, folder, video));
      }
      if (['details','platforms','review'].includes(step)) return send(response, 200, editorView(owner, folder, video, step, null, publishRoutes.context(folder,video)));
    }
    if (request.method !== 'POST' || !['details', 'review', 'platforms', 'publish', 'actions'].includes(step)) {
      throw new InputError('This page is unavailable.', 404);
    }
    const form = await formBody(request);
    requireEditable(owner, folder.id);
    const current = store.getVideo(folder.id, id);
    if (!current) throw new InputError('This draft is unavailable.', 404);
    const base = videoPath(folder.id, id);
    try {
      if (step === 'publish') {
        if (Number(form.get('revision')) !== current.updated_at) throw new InputError('The draft changed. Review the current version before publishing.',409);
        await publishing.queue(owner,folder,current,form.getAll('platform'),form);
        return redirect(response,'/activity');
      }
      if (step === 'platforms') {
        const delivery = Object.fromEntries(platforms.map((platform) => [platform, {
          selected: form.has(platform), caption: (form.get(platform+'-caption') || '').trim().slice(0,10000)
        }]));
        Object.assign(delivery.YouTube,{ kids:form.get('kids'),category:form.get('category') });
        if (delivery.YouTube.category && !/^[1-9]\d?$/.test(delivery.YouTube.category)) throw new InputError('Invalid YouTube category.');
        delivery.Instagram.grid = form.has('grid');
        for (const flag of ['branded','consent','comments','duet','stitch']) delivery.TikTok[flag] = form.has(flag);
        store.saveVideo(folder.id,id,{...current,metadata:{...current.metadata,delivery}},false);
        return redirect(response,base+'/review');
      }
      if (step === 'details') {
        const values = videoDetailsFrom(form, current);
        store.saveVideo(folder.id, id, values, false);
        return apiRequest(request) ? json(response, 200, {}) : redirect(response, `${base}/platforms`);
      }
      if (step === 'review') {
        if (!current.title.trim() || current.title.length > 100) throw new InputError('Enter a title in Details before saving.');
        if (current.thumbnail_format && current.thumbnail_format !== current.format) {
          throw new InputError('Update or remove the thumbnail in Details before saving.');
        }
        store.saveVideo(folder.id, id, current, true);
        return redirect(response, `${folderPath(folder.id)}/videos`);
      }
      const intent = form.get('intent');
      if (['delete','move'].includes(intent) && store.publishing.targets(id).some((row) =>
        ['Publishing','Queued','Check status'].includes(row.state))) throw new InputError('Wait for the pending publication to finish.',409);
      if (intent === 'move' && store.publishing.targets(id).length) throw new InputError('Duplicate this published draft to move a copy.');
      if (intent === 'delete') {
        store.deleteVideo(current);
        media.removeUnused(current.media_key);
      } else if (intent === 'duplicate') {
        return redirect(response, `${videoPath(folder.id, store.duplicateVideo(current))}/details`);
      } else if (intent === 'move') {
        const destination = requireEditable(owner, form.get('destination') || '');
        if (destination.id === folder.id) throw new InputError('Choose a different folder.');
        store.moveVideo(current, destination.id);
      } else throw new InputError('Choose a draft action.');
      return redirect(response, `${folderPath(folder.id)}/videos`);
    } catch (error) {
      if (!(error instanceof InputError) || apiRequest(request)) throw error;
      if (step === 'publish' || step === 'platforms') return send(response,error.status,editorView(owner,folder,current,
        step === 'publish' ? 'review' : step,error.message,publishRoutes.context(folder,current)));
      if (step === 'actions') return showVideos(response, url, owner, folder, error);
      if (step === 'details') {
        const metadata = { ...current.metadata, description: form.get('description') || '',
          hashtags: [form.get('hashtags') || ''], tags: [form.get('tags') || ''],
          visibility: form.get('visibility') || current.metadata.visibility };
        const format = formats.includes(form.get('format')) ? form.get('format') : current.format;
        return send(response, error.status, editorView(owner, folder, {
          ...current, title: form.get('title') || '', format, metadata
        }, step, error.message));
      }
      return send(response, error.status, editorView(owner, folder, current, step, error.message));
    }
  }

  return async function handleDraft(request, response, url, owner) {
    try {
      const path = url.pathname;
      if (path === '/channels' || path === '/onboarding') return await channelList(request, response, url, owner);
      const match = folderRoute.exec(path);
      const folder = match && store.getChannel(owner.id, match[1]);
      if (!folder) throw new InputError('This channel folder is unavailable.', 404);
      const part = match[2] || 'videos';
      if (part === 'accounts') return await publishRoutes.accounts(request,response,folder,owner);
      if (part === 'settings') return await folderSettings(request, response, owner, folder);
      if (part === 'defaults') return await folderDefaults(request, response, owner, folder);
      if (part === 'videos' && request.method === 'GET') return showVideos(response, url, owner, folder);
      if (part === 'videos/new' && request.method === 'GET') {
        requireEditable(owner, folder.id);
        return send(response, 200, uploadView(owner, folder));
      }
      const transfer = transferRoute.exec(part);
      if (transfer) return await upload(request, response, owner, folder, transfer[1], transfer[2]);
      const draft = draftRoute.exec(part);
      if (draft) return await videoEditor(request, response, url, owner, folder, draft[1], draft[2]);
      throw new InputError('This page is unavailable.', 404);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      return apiRequest(request)
        ? json(response, error.status, { error: error.message })
        : send(response, error.status, messageView(error.status === 404 ? 'Page not found' : 'Action unavailable', error.message, owner));
    }
  };
}
