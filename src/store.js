import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const sessionLifetime = 7 * 24 * 60 * 60;
export const attemptWindow = 15 * 60 * 1000;
const attemptLimit = 10;

const foundation = readFileSync(new URL('./migrations/001-foundation.sql', import.meta.url), 'utf8');

function migrate(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { user_version: version } = db.prepare('PRAGMA user_version').get();
    if (version > 1) throw new Error('The database requires a newer version of Upload Hub.');
    if (version === 0) {
      db.exec(foundation);
      db.exec('PRAGMA user_version = 1');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);

  const owner = db.prepare('SELECT * FROM owners WHERE id = 1');
  const create = db.prepare(`
    INSERT INTO owners (id, email, name, password_hash) VALUES (1, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING
  `);
  const firstTimeZone = db.prepare('UPDATE owners SET time_zone = ? WHERE id = 1 AND time_zone IS NULL');
  const save = db.prepare('UPDATE owners SET name = ?, email = ?, time_zone = ? WHERE id = ?');
  const findSession = db.prepare(`
    SELECT owners.id, name, email, time_zone FROM sessions
    JOIN owners ON owners.id = sessions.owner_id
    WHERE token_hash = ? AND expires_at > ?
  `);
  const insertSession = db.prepare('INSERT INTO sessions VALUES (?, 1, ?)');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const pruneSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const pruneAttempts = db.prepare('DELETE FROM login_attempts WHERE expires_at <= ?');
  const countAttempt = db.prepare(`
    INSERT INTO login_attempts VALUES (?, 1, ?)
    ON CONFLICT (address) DO UPDATE SET attempts = min(attempts + 1, 11)
    RETURNING attempts, expires_at
  `);
  const clearAttempts = db.prepare('DELETE FROM login_attempts WHERE address = ?');

  return {
    close: () => db.close(),
    getOwner: () => owner.get(),
    createOwner: ({ email, name, passwordHash }) => create.run(email, name, passwordHash).changes === 1,
    setInitialTimeZone: (timeZone) => firstTimeZone.run(timeZone),
    saveSettings: (id, { name, email, timeZone }) => save.run(name, email, timeZone, id),
    findSession: (hash) => findSession.get(hash, Date.now()),
    deleteSession: (hash) => deleteSession.run(hash),
    createSession(hash) {
      const now = Date.now();
      pruneSessions.run(now);
      insertSession.run(hash, now + sessionLifetime * 1000);
    },
    reserveLogin(address) {
      const now = Date.now();
      pruneAttempts.run(now);
      const result = countAttempt.get(address, now + attemptWindow);
      return result.attempts <= attemptLimit ? 0 : Math.ceil((result.expires_at - now) / 1000);
    },
    clearAttempts: (address) => clearAttempts.run(address)
  };
}
