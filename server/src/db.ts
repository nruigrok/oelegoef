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

const row = db.prepare("SELECT id FROM game_state WHERE id = 1").get();
if (!row) {
  db.prepare(
    `INSERT INTO game_state (id, hunger, weight, cat_spot, food_spot, food_full, updated_at)
     VALUES (1, 20, 50, 'floor-left', NULL, 1, ?)`
  ).run(Date.now());
}
