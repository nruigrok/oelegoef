import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getDecayedState, moveCat, placeFood, moveFood, refillFood, eatFood, debugSetState, isValidFoodLevel } from "./state.js";
import { isValidSpotId } from "./spots.js";
import {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  startPushNotificationScheduler,
  checkAndNotify,
  listSubscriptions,
  setNotifyAfter,
  areNotificationsPaused,
  setNotificationsPaused,
} from "./push.js";

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

app.post("/api/move-food", (req, res) => {
  const { spotId } = req.body ?? {};
  if (!isValidSpotId(spotId)) {
    res.status(400).json({ error: "spotId must be a known spot" });
    return;
  }
  res.json(moveFood(spotId));
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
  const { hunger, weight, catSpot, foodSpot, foodLevel, gramsToday, gramsYesterday, updatedAt } = req.body ?? {};

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
      gramsToday: typeof gramsToday === "number" ? gramsToday : undefined,
      gramsYesterday: typeof gramsYesterday === "number" ? gramsYesterday : undefined,
      // Lets a gap (elapsed time, self-feed rolls, day rollover) be simulated without
      // waiting for real time to pass — see debugSetState()'s doc comment.
      updatedAt: typeof updatedAt === "number" ? updatedAt : undefined,
    })
  );
});

app.get("/api/push/vapid-public-key", (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

app.post("/api/push/subscribe", (req, res) => {
  const { endpoint, keys } = req.body ?? {};
  if (typeof endpoint !== "string" || !endpoint) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    res.status(400).json({ error: "keys.p256dh and keys.auth are required" });
    return;
  }
  subscribe({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  res.json({ ok: true });
});

app.post("/api/push/unsubscribe", (req, res) => {
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== "string" || !endpoint) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }
  unsubscribe(endpoint);
  res.json({ ok: true });
});

// Testing-only backdoor, same spirit as /api/debug above: fires the periodic
// hunger-notification check immediately instead of waiting up to CHECK_INTERVAL_MS.
// ?force=true bypasses quiet hours and the renotify cooldown (still requires he's
// actually very hungry, and still honors the manual pause switch) — for confirming
// delivery to a newly-subscribed device right now. See push.ts's checkAndNotify().
app.post("/api/push/check-now", (req, res) => {
  checkAndNotify({ force: req.query.force === "true" })
    .then(() => res.json({ checked: true }))
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: "check failed" });
    });
});

// Admin-only backdoors for scripts/push-delay.mjs, never called from the client — see
// push.ts's sendToAll() for how notifyAfter holds a subscription back.
app.get("/api/push/subscriptions", (_req, res) => {
  res.json(listSubscriptions());
});

app.post("/api/push/set-notify-after", (req, res) => {
  const { endpoint, notifyAfter } = req.body ?? {};
  if (typeof endpoint !== "string" || !endpoint) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }
  if (typeof notifyAfter !== "number") {
    res.status(400).json({ error: "notifyAfter must be an epoch-ms number" });
    return;
  }
  const found = setNotifyAfter(endpoint, notifyAfter);
  if (!found) {
    res.status(404).json({ error: "no subscription with that endpoint" });
    return;
  }
  res.json({ ok: true });
});

// Manual kill switch for all subscribers, for scripts/push-pause.mjs — never called
// from the client. Independent of quiet hours and per-subscription notify_after.
app.get("/api/push/pause-status", (_req, res) => {
  res.json({ paused: areNotificationsPaused() });
});

app.post("/api/push/pause", (_req, res) => {
  setNotificationsPaused(true);
  res.json({ paused: true });
});

app.post("/api/push/resume", (_req, res) => {
  setNotificationsPaused(false);
  res.json({ paused: false });
});

// In production, the client is built into ../client/dist and served from here
// so the whole app is a single process on a single port.
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Toby server listening on http://localhost:${PORT}`);
  startPushNotificationScheduler();
});
