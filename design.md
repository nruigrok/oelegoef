# Toby — Design Document

A persistent, browser-based virtual pet game in the spirit of Tamagotchi, themed on our
real (elderly, senile, food-forgetting) cat Toby. One shared cat, tended asynchronously
by whoever checks in — feed him, or he slowly wastes away and gets hungrier. No death,
no failure state — just an old cat who needs looking after.

## 1. Concept & Tone

Toby sleeps almost all the time. Occasionally he stirs and meows. He forgets that food
exists even when it's right next to him. The player's job is exactly what we do in real
life: notice he needs to eat, put food down, and physically bring cat and food together
— by dragging either one to the other.

This is low-pressure and a little melancholy-sweet, not a hard-fail management game.
Neglect makes Toby thin and mopey, never dead. The win condition is just... taking care
of him, indefinitely, the same way we do with the real one.

## 2. Players & State Model

**Single shared cat, no accounts.** There is exactly one Toby, one global game state.
Anyone with the link (me, my wife, whoever) can open the game and tend to him — this
matches how it actually works at home, where whoever's around deals with the cat. No
login, no per-user save files.

Because multiple people may check in at different times from different devices, the cat
and food *positions* and the *stats* are the persisted, shared truth. Moment-to-moment
animation (is he currently asleep, mid-stride, mid-meow) is **not** synced live between
simultaneous viewers — see §7. Two people are extremely unlikely to be looking at the
game at the exact same second, so this keeps the backend trivial and avoids needing
websockets/polling infrastructure for real-time sync.

## 3. Stats & Simulation

Two persistent stats, each `0–100`, simulated continuously against wall-clock time (not
"ticks while a tab is open"). Every time the client fetches state, the server first
applies decay for elapsed time since `updated_at`, persists the result, then returns it.
No cron job needed.

- **Hunger** — `0` (full) to `100` (starving). Rises **+5/hour**. Feeding drops it by a
  large fixed amount (e.g. `-70`, floored at 0) rather than resetting to 0, so
  back-to-back feeding doesn't feel exploitable.
- **Weight** — `0` (too thin) to `100`, healthy band roughly `40–60`. Decays
  **-0.5/hour** on its own (metabolism/age — mirrors "he loses weight unless he eats").
  Each successful feeding adds a flat **+3**, capped at 100.

These numbers are starting proposals, easy to retune after playtesting — the point is
the shape: weight trends down over roughly a week without feeding, hunger becomes
noticeable within a day, matching a "check in every several hours" cadence.

Visual/behavioral thresholds:

| Hunger | State |
|---|---|
| 0–30 | Content — occasional happy purr/meow |
| 30–70 | Normal |
| 70–100 | Hungry — wakes and meows more often, sad idle animation |

| Weight | State |
|---|---|
| 0–25 | Too thin — visibly skinnier sprite |
| 25–75 | Healthy |
| 75–100 | Chonky (flavor only, low priority) |

No death, no game over, no reset. These are the only failure signals, and they're
always reversible by feeding.

## 4. Cat Behavior (state machine)

States: `ASLEEP → STIRRING → AWAKE_IDLE → WALKING`, plus `EATING` reachable from any
state.

- **ASLEEP** (~99% of the time): cat sprite is stationary at its last known position.
  Occasionally rolls into `STIRRING` on a random timer, weighted so a hungrier cat
  stirs more often (a built-in, in-game "he wants food" cue — see §6 on why we're
  *not* doing push notifications for this).
- **STIRRING**: brief meow/twitch animation. If the player taps the cat, moves to
  `AWAKE_IDLE`; if ignored for a few seconds, falls back to `ASLEEP`.
- **AWAKE_IDLE / WALKING**: cat occasionally wanders a short distance within the scene
  bounds, otherwise idles.
- **EATING**: triggered by proximity match between cat and food (see §5), regardless of
  which state the cat was previously in — a sleeping cat can be dragged straight to food
  and will groggily eat, exactly like the real Toby. After the eating animation
  completes, hunger/weight are updated and the cat returns to `ASLEEP`.

Tapping/clicking the cat outside of feeding is a pure charm interaction (wake him up,
get a meow) — it's not required to feed him.

## 5. Feeding Interaction

1. A food item (chicken icon) sits in a small supply tray in the UI, always available
   — no inventory/resource limits for v1, keeping this a caretaking loop rather than a
   resource-management one.
2. The player drags it into the scene to place a food bowl at a chosen spot.
3. The player then drags **either** the cat onto the food **or** the food onto the cat
   — both directions work, mirroring "we pick him up and set him in front of the
   chicken, or pick up the chicken and set it in front of him."
4. On proximity match, the client calls the feed action; the cat enters `EATING`, the
   food bowl is consumed, hunger drops and weight ticks up per §3.

Dragging is implemented with pointer events (not native HTML5 drag-and-drop), so it
works the same with mouse and touch — this will mostly be used from a phone.

## 6. Visual Style

Simple, flat, cartoon 2D. A single background scene (a room), a cat sprite, a food
bowl/chicken sprite. Animation via a small hand-drawn sprite sheet per cat state
(asleep, stirring/meow, idle, walk, eat) stepped with CSS, rendered as absolutely
positioned DOM elements rather than canvas — there's only ever one character and one
prop on screen, so DOM+CSS is simpler to build and art-direct than a canvas renderer.

No push notifications for v1. The in-game "stirs and meows more when hungry" behavior
(§4) is the only nudge; checking in is opportunistic, which keeps the backend free of
push-subscription infrastructure. (Worth revisiting later if check-ins turn out to be
too infrequent in practice.)

## 7. Persistence & API

Backend: **Node.js + Express + SQLite**, a single Express process that also serves the
built Vite static assets — one process, one port, nothing to orchestrate. No auth.

Uses `node:sqlite` (Node's built-in SQLite module, stable as of Node 22.5+) rather than
a third-party driver like `better-sqlite3` — same synchronous API shape, but no native
addon to compile, which matters since `better-sqlite3`'s prebuilt binaries and native
build can lag behind the newest Node versions.

Single-row table `game_state`:

```
hunger      REAL
weight      REAL
cat_x       REAL
cat_y       REAL
food_x      REAL NULLABLE
food_y      REAL NULLABLE
updated_at  TIMESTAMP
```

Endpoints:

- `GET /api/state` — applies elapsed-time decay to hunger/weight since `updated_at`,
  persists and returns the recomputed state (cat position, food position, hunger,
  weight).
- `POST /api/move-cat { x, y }` — updates `cat_x/cat_y` (so the cat is left where the
  last player dropped it).
- `POST /api/place-food { x, y }` — sets `food_x/food_y`.
- `POST /api/feed` — server validates cat/food positions are within proximity
  threshold, applies the hunger/weight update, clears `food_x/food_y`, returns new
  state.

Ephemeral, non-persisted client state: which sub-state of `ASLEEP/STIRRING/AWAKE_IDLE/
WALKING` the cat is currently animating through, and in-progress drag positions. This
is recomputed fresh each time a client loads — it's cosmetic and doesn't need to be
shared between simultaneous viewers.

## 8. Frontend Architecture

Vite + TypeScript, **vanilla** (no UI framework) — the scope is one scene with a
handful of elements, which doesn't warrant React/Vue overhead. Rough shape:

- A small local game loop (`requestAnimationFrame` or interval) driving the cat's
  client-side state machine and idle animations.
- Pointer-event drag handling for cat and food sprites.
- Sync with the backend: fetch `GET /api/state` on load, and after any action that
  changes persisted state (feed, move-cat, place-food); no continuous polling needed
  since this isn't a real-time multiplayer game.

## 9. Out of Scope for v1

Ideas worth keeping in mind but deliberately deferred:

- Food depletes slowly rather than being consumed in one go
- Old food needs to be cleared before we can feed
- "Resource management" - shopping and boiling food. Different kinds of food
- Push notifications / reminders
- Day/night cycle
- History graph of hunger/weight over time
- Sound effects

## 10. Open Tuning Parameters

Not design decisions so much as numbers to adjust after actually playing with it:

- Hunger rise rate, feed amount, weight decay/gain rate (§3)
- Stir/wake frequency curve vs. hunger (§4)
- Proximity threshold for a successful feed (§5)
