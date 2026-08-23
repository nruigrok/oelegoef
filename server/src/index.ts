import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDecayedState, moveCat, placeFood, refillFood, eatFood, debugSetState, isValidFoodLevel } from "./state.js";
import { isValidSpotId } from "./spots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

const app = express();
app.use(express.json());

app.get("/api/state", (req, res) => {
  res.json(getDecayedState({ allowWander: req.query.fresh === "true" }));
});

app.post("/api/move-cat", (req, res) => {
  const { spotId } = req.body ?? {};
  if (!isValidSpotId(spotId)) {
    res.status(400).json({ error: "spotId must be a known spot" });
    return;
  }
  res.json(moveCat(spotId));
});

app.post("/api/place-food", (req, res) => {
  const { spotId } = req.body ?? {};
  if (!isValidSpotId(spotId)) {
    res.status(400).json({ error: "spotId must be a known spot" });
    return;
  }
  res.json(placeFood(spotId));
});

app.post("/api/feed", (_req, res) => {
  const { fed, state } = eatFood();
  res.json({ fed, state });
});

app.post("/api/refill-food", (_req, res) => {
  res.json(refillFood());
});

// Testing-only backdoor to force hunger/weight/spots/bowl state directly, e.g. to see
// hungry/thin thresholds without waiting hours for decay. See scripts/debug-set.mjs.
app.post("/api/debug", (req, res) => {
  const { hunger, weight, catSpot, foodSpot, foodLevel } = req.body ?? {};

  if (catSpot !== undefined && !isValidSpotId(catSpot)) {
    res.status(400).json({ error: "catSpot must be a known spot" });
    return;
  }
  if (foodSpot !== undefined && foodSpot !== null && !isValidSpotId(foodSpot)) {
    res.status(400).json({ error: "foodSpot must be a known spot or null" });
    return;
  }
  if (foodLevel !== undefined && !isValidFoodLevel(foodLevel)) {
    res.status(400).json({ error: "foodLevel must be one of full/half/almostempty/empty" });
    return;
  }

  res.json(
    debugSetState({
      hunger: typeof hunger === "number" ? hunger : undefined,
      weight: typeof weight === "number" ? weight : undefined,
      catSpot,
      foodSpot,
      foodLevel,
    })
  );
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
