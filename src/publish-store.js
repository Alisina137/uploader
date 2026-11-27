import { InputError } from './draft-model.js';
export function publishStore(db) {
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function event(owner, channel, title, platform, state, detail, target = null) {
    run('INSERT INTO publish_events(owner_id,channel,title,platform,state,detail,target,created) VALUES(?,?,?,?,?,?,?,?)',
      owner, channel, title, platform, state, detail, target, Date.now());
  }
  function atomic(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    profile: (id) => get('SELECT * FROM partner_profiles WHERE channel_id=?', id),
    putProfile: (id, secret) => run('INSERT INTO partner_profiles(channel_id,secret) VALUES(?,?)', id, secret),
    forgetProfile: (id) => run('DELETE FROM partner_profiles WHERE channel_id=?', id),
    setAccounts: (id, accounts) => run('UPDATE partner_profiles SET accounts=? WHERE channel_id=?', JSON.stringify(accounts), id),
    linkAttempt: (id, platform, expires) => run('INSERT OR REPLACE INTO link_attempts VALUES(?,?,?)', id, platform, expires),
    links: (id) => all('SELECT * FROM link_attempts WHERE channel_id=?', id),
    clearLink: (id, platform) => run('DELETE FROM link_attempts WHERE channel_id=? AND platform=?', id, platform),
    rules: () => all('SELECT * FROM publish_rules'),
    targets: (video) => all('SELECT * FROM publications WHERE video_id=?', video),
    target: (id) => get('SELECT * FROM publications WHERE id=?', id),
    activeFolder: (id) => get("SELECT 1 FROM publications WHERE channel_id=? AND state IN ('Queued','Publishing','Check status')", id),
    events: (owner, filter) => all("SELECT * FROM publish_events WHERE owner_id=? AND (?='' OR state=?) ORDER BY id DESC LIMIT 250", owner, filter, filter),
    event,
    reserve(owner, folder, video, jobs) {
      atomic(() => {
        for (const job of jobs) {
          const old = get('SELECT * FROM publications WHERE video_id=? AND platform=?', video.id, job.platform);
          if (old && old.state !== 'Failed') continue;
          const rule = get('SELECT daily_limit FROM publish_rules WHERE platform=?', job.platform);
          const usage = get("SELECT count(*) AS count,min(created) AS first FROM quota_reservations WHERE channel_id=? AND platform=? AND created>?",
            folder.id, job.platform, Date.now()-86400000);
          if (usage.count >= rule.daily_limit) throw new InputError(job.platform + ' limit reached. Next slot ' + new Date(usage.first + 86400000).toISOString(), 429);
          run('DELETE FROM quota_reservations WHERE created<=?',Date.now()-86400000);
          run('INSERT INTO quota_reservations VALUES(?,?,?,?)',job.id,folder.id,job.platform,Date.now());
          if (old) run('DELETE FROM publications WHERE id=?', old.id);
          run('INSERT INTO publications(id,video_id,channel_id,platform,state,payload,due,created) VALUES(?,?,?,?,?,?,?,?)',
            job.id, video.id, folder.id, job.platform, 'Queued', JSON.stringify(job.payload), Date.now(), Date.now());
          event(owner, folder.name, video.title, job.platform, 'Queued', 'Ready for submission.', job.id);
        }
      });
    },
    ready: () => all("SELECT * FROM publications WHERE (state IN ('Queued','Publishing') OR (state IN ('Needs manual action','Check status') AND provider_id IS NOT NULL)) AND due<=? ORDER BY due LIMIT 10", Date.now()),
    lease(id) {
      return run("UPDATE publications SET due=? WHERE id=? AND due<=? AND (state IN ('Queued','Publishing') OR (state IN ('Needs manual action','Check status') AND provider_id IS NOT NULL))",
        Date.now()+90000, id, Date.now()).changes === 1;
    },
    record(row, state, detail, providerId, attempts, delay) {
      atomic(() => {
        run('UPDATE publications SET state=?,detail=?,provider_id=?,attempts=?,due=? WHERE id=?',
          state, detail, providerId || row.provider_id, attempts, Date.now()+delay, row.id);
        if (state === 'Failed') run('DELETE FROM quota_reservations WHERE target=?',row.id);
        if (state === row.state && row.detail === detail) return;
        const item = get('SELECT c.owner_id,c.name,v.title FROM channels c JOIN videos v ON v.channel_id=c.id WHERE v.id=?', row.video_id);
        if (item) event(item.owner_id,item.name,item.title,row.platform,state,detail,row.id);
      });
    }
  };
}
