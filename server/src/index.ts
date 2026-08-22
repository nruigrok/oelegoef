import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDecayedState, moveCat, placeFood, tryFeed } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

const app = express();
app.use(express.json());

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

app.get("/api/state", (_req, res) => {
  res.json(getDecayedState());
});

app.post("/api/move-cat", (req, res) => {
  const { x, y } = req.body ?? {};
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    res.status(400).json({ error: "x and y must be numbers" });
    return;
  }
  res.json(moveCat(x, y));
});

app.post("/api/place-food", (req, res) => {
  const { x, y } = req.body ?? {};
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    res.status(400).json({ error: "x and y must be numbers" });
    return;
  }
  res.json(placeFood(x, y));
});

app.post("/api/feed", (_req, res) => {
  const { fed, state } = tryFeed();
  res.json({ fed, state });
});

// In production, the client is built into ../client/dist and served from here
// so the whole app is a single process on a single port.
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Toby server listening on http://localhost:${PORT}`);
});
