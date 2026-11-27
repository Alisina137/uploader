import { randomUUID } from 'node:crypto';
import { InputError, initialMetadata, pageSize, suggestedFormat } from './draft-model.js';

const decodeChannel = (row) => row && { ...row, defaults: JSON.parse(row.defaults) };
const decodeVideo = (row) => row && { ...row, metadata: JSON.parse(row.metadata) };

export function draftStore(db) {
  db.function('fold_title', { deterministic: true }, (value) => value.normalize('NFC').toLocaleLowerCase('en'));
  const channel = db.prepare('SELECT * FROM channels WHERE owner_id = ? AND id = ?');
  const insertChannel = db.prepare('INSERT INTO channels (id, owner_id, name, name_key) VALUES (?, ?, ?, ?)');
  const getVideo = db.prepare(`
    SELECT videos.*, thumbnails.format AS thumbnail_format FROM videos
    LEFT JOIN thumbnails ON thumbnails.video_id = videos.id WHERE channel_id = ? AND videos.id = ?
  `);
  const insertVideo = db.prepare(`
    INSERT INTO videos (id, channel_id, media_key, file_hash, filename, duration, width, height, format, title,
      metadata, updated_at, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getUpload = db.prepare('SELECT * FROM uploads WHERE channel_id = ? AND id = ?');
  const deleteUpload = db.prepare('DELETE FROM uploads WHERE id = ?');
  const hasName = db.prepare('SELECT 1 FROM channels WHERE owner_id = ? AND name_key = ? AND id <> ?');
  const keyOf = (name) => name.toLocaleLowerCase('en');
  const assertName = (owner, name, except = '') => {
    if (hasName.get(owner, keyOf(name), except)) throw new InputError('A folder with this name already exists.', 409);
  };

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    listChannels(owner, query = '', archived = 0) {
      return db.prepare(`
        SELECT channels.*, (SELECT count(*) FROM videos v WHERE channel_id = channels.id AND NOT EXISTS
          (SELECT 1 FROM publications p WHERE p.video_id=v.id)) AS drafts,
          (SELECT count(DISTINCT p.video_id) FROM publications p WHERE p.channel_id=channels.id AND p.state='Published') AS published
        FROM channels WHERE owner_id = ? AND archived = ? AND instr(name_key, ?) > 0
        ORDER BY name_key, id
      `).all(owner, archived, keyOf(query)).map(decodeChannel);
    },
    getChannel: (owner, id) => decodeChannel(channel.get(owner, id)),
    createChannel(owner, name) {
      return transaction(() => {
        const id = randomUUID();
        assertName(owner, name);
        insertChannel.run(id, owner, name, keyOf(name));
        db.prepare('UPDATE owners SET onboarded = 1 WHERE id = ?').run(owner);
        return id;
      });
    },
    skipOnboarding: (owner) => db.prepare('UPDATE owners SET onboarded = 1 WHERE id = ?').run(owner),
    renameChannel(owner, id, name) {
      return transaction(() => {
        assertName(owner, name, id);
        db.prepare('UPDATE channels SET name = ?, name_key = ? WHERE owner_id = ? AND id = ? AND archived = 0')
          .run(name, keyOf(name), owner, id);
      });
    },
    archiveChannel: (owner, id, archived) =>
      db.prepare('UPDATE channels SET archived = ? WHERE owner_id = ? AND id = ?').run(archived, owner, id),
    saveDefaults: (owner, id, values) =>
      db.prepare('UPDATE channels SET defaults = ? WHERE owner_id = ? AND id = ? AND archived = 0')
        .run(JSON.stringify(values), owner, id),
    deleteChannel(owner, id) {
      return transaction(() => {
        const keys = db.prepare(`
          SELECT media_key AS key FROM videos WHERE channel_id = ? UNION SELECT id AS key FROM uploads WHERE channel_id = ?
        `).all(id, id).map(({ key }) => key);
        db.prepare('DELETE FROM channels WHERE owner_id = ? AND id = ?').run(owner, id);
        return keys;
      });
    },
    listVideos(id, { query, format, order, page, status = '' }) {
      const search = "videos.channel_id = ? AND instr(fold_title(videos.title), fold_title(?)) > 0 AND (? = '' OR videos.format = ?)";
      const where = search + ` AND (?='' OR (?='Draft' AND NOT EXISTS
        (SELECT 1 FROM publications p WHERE p.video_id=videos.id)) OR EXISTS
        (SELECT 1 FROM publications p WHERE p.video_id=videos.id AND p.state=?))`;
      const args = [id, query, format, format, status, status, status];
      const count = db.prepare(`SELECT count(*) AS count FROM videos WHERE ${where}`).get(...args).count;
      const pages = Math.max(1, Math.ceil(count / pageSize));
      const current = Math.min(page, pages);
      const sort = order === 'title' ? 'fold_title(videos.title), videos.id' : 'videos.updated_at DESC, videos.id';
      const rows = db.prepare(`
        SELECT videos.*, thumbnails.format AS thumbnail_format FROM videos
        LEFT JOIN thumbnails ON thumbnails.video_id = videos.id
        WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?
      `).all(...args, pageSize, (current - 1) * pageSize);
      return { rows: rows.map(decodeVideo), page: current, pages };
    },
    getVideo: (id, video) => decodeVideo(getVideo.get(id, video)),
    getUpload: (id, upload) => getUpload.get(id, upload),
    createUpload(id, filename, size) {
      const upload = randomUUID();
      db.prepare('INSERT INTO uploads VALUES (?, ?, ?, ?, ?)').run(upload, id, filename, size, Date.now());
      return upload;
    },
    deleteUpload: (id) => deleteUpload.run(id),
    expireUploads: (before) => db.prepare('DELETE FROM uploads WHERE created_at < ? RETURNING id').all(before),
    referencedMedia: () => db.prepare('SELECT media_key AS key FROM videos UNION SELECT id AS key FROM uploads').all(),
    referencesMedia: (key) => db.prepare('SELECT 1 FROM videos WHERE media_key = ? UNION SELECT 1 FROM uploads WHERE id = ?')
      .get(key, key),
    finalizeUpload(owner, upload, media, allowDuplicate) {
      return transaction(() => {
        const current = channel.get(owner, upload.channel_id);
        if (!current || current.archived || !getUpload.get(upload.channel_id, upload.id)) {
          throw new InputError('This upload is no longer available.', 409);
        }
        const duplicate = db.prepare('SELECT id FROM videos WHERE channel_id = ? AND file_hash = ? LIMIT 1')
          .get(current.id, media.hash);
        if (duplicate && !allowDuplicate) return { duplicate: duplicate.id };
        const id = upload.id;
        insertVideo.run(id, current.id, upload.id, media.hash, upload.filename, media.duration, media.width, media.height,
          suggestedFormat(media), upload.filename.replace(/\.[^.]+$/, '').slice(0, 100),
          JSON.stringify(initialMetadata(JSON.parse(current.defaults))), Date.now(), null);
        deleteUpload.run(upload.id);
        return { id };
      });
    },
    saveVideo(channelId, videoId, values, markSaved) {
      db.prepare(`
        UPDATE videos SET title = ?, format = ?, metadata = ?, updated_at = ?,
          saved_at = coalesce(?, saved_at) WHERE channel_id = ? AND id = ?
      `).run(values.title, values.format, JSON.stringify(values.metadata), Date.now(),
        markSaved ? Date.now() : null, channelId, videoId);
    },
    duplicateVideo(video) {
      return transaction(() => {
        const id = randomUUID();
        insertVideo.run(id, video.channel_id, video.media_key, video.file_hash, video.filename, video.duration,
          video.width, video.height, video.format, video.title.slice(0, 93) + ' (copy)', JSON.stringify(video.metadata),
          Date.now(), Date.now());
        db.prepare('INSERT INTO thumbnails SELECT ?, data, mime, format FROM thumbnails WHERE video_id = ?')
          .run(id, video.id);
        return id;
      });
    },
    moveVideo: (video, destination) =>
      db.prepare('UPDATE videos SET channel_id = ?, updated_at = ? WHERE channel_id = ? AND id = ?')
        .run(destination, Date.now(), video.channel_id, video.id),
    deleteVideo: (video) =>
      db.prepare('DELETE FROM videos WHERE id = ? AND channel_id = ?').run(video.id, video.channel_id),
    getThumbnail: (videoId) => db.prepare('SELECT * FROM thumbnails WHERE video_id = ?').get(videoId),
    saveThumbnail: (videoId, { data, mime, format }) => db.prepare(`
      INSERT INTO thumbnails VALUES (?, ?, ?, ?) ON CONFLICT(video_id)
      DO UPDATE SET data = excluded.data, mime = excluded.mime, format = excluded.format
    `).run(videoId, data, mime, format),
    deleteThumbnail: (videoId) => db.prepare('DELETE FROM thumbnails WHERE video_id = ?').run(videoId)
  };
}
