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
    cat_x REAL NOT NULL,
    cat_y REAL NOT NULL,
    food_x REAL,
    food_y REAL,
    updated_at INTEGER NOT NULL
  )
`);

const row = db.prepare("SELECT id FROM game_state WHERE id = 1").get();
if (!row) {
  db.prepare(
    `INSERT INTO game_state (id, hunger, weight, cat_x, cat_y, food_x, food_y, updated_at)
     VALUES (1, 20, 50, 50, 50, NULL, NULL, ?)`
  ).run(Date.now());
}
