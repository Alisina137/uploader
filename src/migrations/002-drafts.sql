ALTER TABLE owners ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0 CHECK (onboarded IN (0, 1));

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  defaults TEXT NOT NULL DEFAULT '{}',
  UNIQUE (owner_id, name_key)
) STRICT;

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  duration REAL NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('Short', 'Long')),
  title TEXT NOT NULL,
  metadata TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  saved_at INTEGER
) STRICT;

CREATE INDEX videos_channel_date ON videos(channel_id, updated_at DESC, id);
CREATE INDEX videos_channel_hash ON videos(channel_id, file_hash);
CREATE INDEX videos_media_key ON videos(media_key);
CREATE INDEX uploads_channel ON uploads(channel_id);

CREATE TABLE thumbnails (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  data BLOB NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  format TEXT NOT NULL CHECK (format IN ('Short', 'Long'))
) STRICT;
