import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "toby.db");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS game_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    hunger REAL NOT NULL,
    weight REAL NOT NULL,
    cat_spot TEXT NOT NULL,
    food_spot TEXT,
    food_full INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  )
`);

try {
  db.exec("ALTER TABLE game_state ADD COLUMN food_full INTEGER NOT NULL DEFAULT 1");
} catch {
  // already has the column — fine, CREATE TABLE above only runs on a fresh db
}

try {
  db.exec("ALTER TABLE game_state ADD COLUMN food_level TEXT NOT NULL DEFAULT 'full'");
  // One-time backfill from the old full/empty boolean for databases that predate
  // the four-level bowl (full/half/almostempty/empty).
  db.exec("UPDATE game_state SET food_level = CASE WHEN food_full = 1 THEN 'full' ELSE 'empty' END");
} catch {
  // already has the column
}

try {
  db.exec("ALTER TABLE game_state ADD COLUMN last_hunger_notified_at INTEGER");
} catch {
  // already has the column
}

try {
  // Grams-eaten tracking (design.md §3) — day_key defaults to '' so it never matches a
  // real calendar date, which makes the first getDecayedState() call after this
  // migration land on the normal "day advanced" path (harmless: grams_today/yesterday
  // default to 0 anyway on a database that predates this tracking).
  db.exec("ALTER TABLE game_state ADD COLUMN grams_today REAL NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE game_state ADD COLUMN grams_yesterday REAL NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE game_state ADD COLUMN day_key TEXT NOT NULL DEFAULT ''");
} catch {
  // already has the columns
}

// One row per subscribed device/browser — see server/src/push.ts. No accounts, so a
// subscription is identified purely by the Push API's own unique endpoint URL.
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// The single VAPID keypair used to sign/encrypt every push, generated once on first
// boot (see push.ts) and never rotated — browsers bind a subscription to the public
// key it was created with, so a changed key would silently orphan every existing
// subscription. Kept in SQLite rather than an env var since this project has no
// dotenv/env-var infrastructure anywhere else.
db.exec(`
  CREATE TABLE IF NOT EXISTS vapid_keys (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL
  )
`);

try {
  // Epoch ms before which this subscription is held back from sends entirely — 0 (the
  // default) means "no delay, eligible as soon as subscribed". Set manually via
  // scripts/push-delay.mjs; there's no in-app UI for it. See push.ts's sendToAll().
  db.exec("ALTER TABLE push_subscriptions ADD COLUMN notify_after INTEGER NOT NULL DEFAULT 0");
} catch {
  // already has the column
}

const row = db.prepare("SELECT id FROM game_state WHERE id = 1").get();
if (!row) {
  db.prepare(
    `INSERT INTO game_state (id, hunger, weight, cat_spot, food_spot, food_full, food_level, updated_at)
     VALUES (1, 20, 50, 'couch', NULL, 1, 'full', ?)`
  ).run(Date.now());
}
