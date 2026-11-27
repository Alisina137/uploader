import { InputError, platforms } from './draft-model.js';
import { accountsBody, activityPage } from './publish-views.js';
import { folderShell } from './draft-views.js';
import { readForm, redirect, send } from './http.js';

export function publishingRoutes(store, service) {
  const data = store.publishing;
  function context(folder, video) {
    return { configured: service.configured, mode: service.mode, accounts: JSON.parse(data.profile(folder.id)?.accounts || '{}'),
      targets: video ? data.targets(video.id) : [], rules: data.rules() };
  }
  async function accounts(request, response, folder, owner) {
    let message, status = 200;
    try {
      if (request.method === 'POST') {
        const form = await readForm(request);
        const platform = form?.get('platform');
        if (!platforms.includes(platform) || !store.getChannel(owner.id,folder.id) || store.getChannel(owner.id,folder.id).archived) throw new InputError('Choose an active folder and platform.');
        const key = await service.profile(folder);
        if (form.get('intent') === 'connect') {
          const link = await service.partner.link(key, platform.toLowerCase());
          data.linkAttempt(folder.id,platform,link.expires);
          response.setHeader('Referrer-Policy','no-referrer');
          return redirect(response,link.url);
        }
        if (form.get('intent') !== 'disconnect') throw new InputError('Invalid account action.');
        await service.partner.disconnect(key,platform.toLowerCase());
        data.clearLink(folder.id, platform);
        await service.refresh(folder);
        return redirect(response,'/channels/' + folder.id + '/accounts');
      }
      if (request.method !== 'GET') throw new InputError('Unsupported request.',405);
      if (service.configured) await service.refresh(folder);
    } catch (error) {
      message = error instanceof InputError ? error.message : 'Could not check the account. Try again.';
      status = error.status || 503;
    }
    return send(response,status,folderShell(owner,folder,'accounts',accountsBody(folder,context(folder),data.links(folder.id),message)));
  }

  async function activity(request,response,url,owner) {
    if (url.pathname === '/activity/retry' && request.method === 'POST') {
      const form = await readForm(request);
      const target = data.target(form?.get('id') || '');
      const folder = target && store.getChannel(owner.id,target.channel_id);
      if (!folder || folder.archived || target.state !== 'Failed') throw new InputError('This target cannot be retried.',409);
      await service.queue(owner,folder,store.getVideo(folder.id,target.video_id),[target.platform]);
      return redirect(response,'/activity');
    }
    if (url.pathname !== '/activity' || request.method !== 'GET') throw new InputError('Page unavailable.',404);
    const filter = url.searchParams.get('state') || '';
    const rows = data.events(owner.id,filter);
    const seen = new Set();
    for (const row of rows) {
      if (!row.target || seen.has(row.target)) continue;
      seen.add(row.target);
      row.retry = row.state === 'Failed' && data.target(row.target)?.state === 'Failed';
    }
    return send(response,200,activityPage(owner,rows,filter));
  }
  return { accounts, activity, context };
}
