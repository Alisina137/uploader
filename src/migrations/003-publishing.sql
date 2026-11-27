CREATE TABLE partner_profiles (
 channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
 secret TEXT NOT NULL, accounts TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE TABLE link_attempts (
 channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 platform TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(channel_id,platform)
) STRICT;
CREATE TABLE publish_rules (
 platform TEXT PRIMARY KEY, caption_limit INTEGER NOT NULL, daily_limit INTEGER NOT NULL,
 min_ratio REAL NOT NULL, max_ratio REAL NOT NULL
) STRICT;
INSERT INTO publish_rules VALUES ('YouTube',5000,100,0.1,10),('Facebook',63206,30,0.1,10),
 ('Instagram',2200,50,0.5625,1.91),('TikTok',2200,15,0.5,2);
CREATE TABLE publications (
 id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
 channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, platform TEXT NOT NULL,
 state TEXT NOT NULL, payload TEXT NOT NULL, provider_id TEXT, detail TEXT NOT NULL DEFAULT '',
 attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, created INTEGER NOT NULL,
 UNIQUE(video_id, platform)
) STRICT;
CREATE INDEX publication_queue ON publications(state,due);
CREATE TABLE publish_events (
 id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id), channel TEXT NOT NULL,
 title TEXT NOT NULL, platform TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL,
 target TEXT, created INTEGER NOT NULL
) STRICT;
CREATE TABLE quota_reservations (
 target TEXT PRIMARY KEY, channel_id TEXT NOT NULL, platform TEXT NOT NULL, created INTEGER NOT NULL
) STRICT;
CREATE INDEX quota_window ON quota_reservations(channel_id,platform,created);
