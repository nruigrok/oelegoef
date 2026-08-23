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

Four real states — `ASLEEP`, `LYINGDOWN`, `SITTING`, `DRAGGED` — connected by one-shot
transition animations, arranged as a hierarchy from deepest sleep to most alert:
`ASLEEP ⇄ LYINGDOWN ⇄ SITTING`, with `DRAGGED` reachable from (and returning to)
`LYINGDOWN` regardless of where he started. Both `LYINGDOWN` and `SITTING` are
transient — each auto-settles one level down after a hold timer, so nothing except
active player attention keeps him more awake than `ASLEEP`.

- **ASLEEP** (~99% of the time): stationary, deep sleep. Occasionally twitches on a
  random timer weighted so a hungrier cat stirs more, purely cosmetic (a built-in,
  in-game "he wants food" cue — see §7 on why we're *not* doing push notifications for
  this). Exited only by a tap (→ `LYINGDOWN`, startled) or a drag.
- **LYINGDOWN**: resting, alert-ish. Reached from `ASLEEP` (tapped → startled awake),
  from `SITTING` (settles back down after its hold timer), from `DRAGGED` (set down
  without being fed), or after eating. Auto-transitions to `ASLEEP` after ~2.5s via a
  "drifting off" animation unless tapped first, which instead sits him up.
- **SITTING**: upright and alert. Reached only by tapping a `LYINGDOWN` cat ("sits up"
  animation) — the most awake he gets without being handled directly. Auto-transitions
  back to `LYINGDOWN` after ~3s via a "sitting down" animation. Tapping while `SITTING`
  does nothing further for now.
- **DRAGGED**: being held/moved by the player. Entered from `LYINGDOWN`, `SITTING`, or
  `ASLEEP` via a "picked up" animation; exited via a "released" animation the moment
  the player lets go, landing back in `LYINGDOWN` (see §6 for how drop position
  resolves to a spot) — regardless of which state he was in when picked up, a sleeping
  cat can be grabbed straight off the couch and will groggily go along with it, exactly
  like the real Toby. If the spot he lands on has food, landing in `LYINGDOWN` triggers
  the noticing check below rather than eating immediately.

**Noticing food**: an awake cat (`LYINGDOWN` or `SITTING`) whose spot matches a full
bowl's spot notices it — checked at the two moments this can newly become true: the
food or the cat arriving at the other's spot (§5), and the cat waking up when food was
already sitting there (asleep cats don't notice; dragging doesn't count as awake). On
noticing, he sits up ("notice" reuses the sit-up animation) and pauses briefly as if
considering it, then resolves to either eating (§5) or turning it down (a "nope"
animation) before settling back to `SITTING` (not `LYINGDOWN` — from there he follows
the normal `SITTING` hold timer down) — the food stays exactly where it was either
way. Whether he eats is a hunger-weighted coin flip, not automatic: hungrier
means more likely, but even well-fed he'll often still take a bite.

Transitions only exist for one facing (southeast); the mirrored facing (southwest) is
a CSS horizontal flip, not a separate asset (see §7).

Petting is the other interaction for an awake cat (below); the tooltip on the cat
sprite switches between "Tap to wake him" (asleep) and "Pet him!" (lying down or
sitting) to match.

**Petting**: a gesture that moves but stays within a small radius of his current spot
(more than a tap, not far enough to count as picking him up) loops a purr for as long
as the pointer stays down, instead of starting a drag — he doesn't move. v1 is
sound-only regardless of state; no sprite change, no effect on the sleep timer. A real
drag only starts once the pointer travels past that radius, from wherever it is at
that point — the purr loop stops the instant that happens.

## 5. Feeding Interaction

1. A food bowl sits in a small supply tray in the UI, always available — no
   inventory/resource limits for v1, keeping this a caretaking loop rather than a
   resource-management one. There's only ever one bowl in play: the tray shows it
   (full) exactly when it isn't currently out in the scene.
2. The player drags it into the scene; it snaps to whichever spot (see §6) it's
   dropped nearest to, landing just to the right of that spot so it doesn't sit right
   on top of the cat.
3. The player then drags **either** the cat onto the food **or** the food onto the cat
   — both directions work, mirroring "we pick him up and set him in front of the
   chicken, or pick up the chicken and set it in front of him." Dragging snaps to a
   spot the same way.
4. When the cat's spot and the food's spot match and the cat is awake, he notices the
   food (§4) and decides whether to eat it. If he eats: an eating animation plays,
   hunger drops and weight ticks up per §3, and the bowl sprite switches from full to
   empty — it stays put rather than disappearing. If he turns it down: a "nope"
   animation plays and the bowl is left full.
5. Dragging the bowl (full or empty) back onto the tray returns it there and refills
   it, ready to be placed again.

Dragging is implemented with pointer events (not native HTML5 drag-and-drop), so it
works the same with mouse and touch — this will mostly be used from a phone.

## 6. Room & Spots

The room is a single painted background image (a real illustrated room, window included)
with every piece of furniture already baked into the art — there are no separate
furniture sprites to place or size. The cat and the food can only ever be at one of a
small set of **named spots**, each just a fixed pixel coordinate on that background
image: dragging snaps to whichever spot is nearest the drop point.

This mirrors how you'd actually place a cat by hand — there's always a specific spot
you're aiming for — and it simplifies feeding considerably: a feed succeeds when the
cat's spot and the food's spot are the same, no distance/proximity math needed.

v1 spots, each a landing point on the background art:

| Spot | Where |
|---|---|
| `windowsill` | On the sill, left end, in front of the window |
| `footstool` | On top of the red ottoman |
| `table` | On top of the round dining table |
| `couch` | On the couch, right side |
| `floor-right` | Open floor, on the rug |
| `floor-left` | Open floor, bottom-left corner |

This list is easy to extend later — adding a spot is just picking a new pixel
coordinate on the background, no new art or mechanics.

## 7. Visual Style

A single illustrated background image (the room from §6, furniture included), a cat
sprite, a food bowl sprite (full/empty). Animation via a small hand-drawn sprite sheet
per cat state (asleep, stirring/meow, idle, walk, eat) stepped with CSS, rendered as
absolutely positioned DOM elements rather than canvas — one character and one prop
over a static background is still cheap enough that DOM+CSS is simpler to build and
art-direct than a canvas renderer.

No push notifications for v1. The in-game "stirs and meows more when hungry" behavior
(§4) is the only nudge; checking in is opportunistic, which keeps the backend free of
push-subscription infrastructure. (Worth revisiting later if check-ins turn out to be
too infrequent in practice.)

**Sound**: a meow plays on deliberate player actions (tapping the cat), and a purr
plays when he's successfully fed — both tied to an explicit action, not to the
passive/ambient stirring animation, so leaving the tab open doesn't produce
unprompted audio every few seconds. A mute toggle in the header persists to
`localStorage` (a device-local preference, not part of the shared game state).

## 8. Persistence & API

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
cat_spot    TEXT
food_spot   TEXT NULLABLE
food_full   BOOLEAN
updated_at  TIMESTAMP
```

`cat_spot`/`food_spot` hold one of the spot ids from §6 (e.g. `"couch"`). The set of
valid spot ids is small and hand-authored, duplicated as a plain list in both the
client (for rendering/snapping) and the server (for validating incoming spot ids) —
not worth a shared package at this scale, just something to keep in sync by hand when
the spot list changes.

Endpoints:

- `GET /api/state` — applies elapsed-time decay to hunger/weight since `updated_at`,
  persists and returns the recomputed state (cat spot, food spot, hunger, weight).
- `POST /api/move-cat { spotId }` — updates `cat_spot` (so the cat is left wherever
  the last player dropped it). 400s if `spotId` isn't a known spot.
- `POST /api/place-food { spotId }` — sets `food_spot` and marks the bowl full (a
  fresh bowl from the tray). Same spot validation as `move-cat`.
- `POST /api/feed` — feeds if `food_spot` is set, equals `cat_spot`, and the bowl is
  full; applies the hunger/weight update and marks the bowl empty (`food_spot` is left
  as-is — the bowl stays in the scene). Returns `{ fed, state }` either way.
- `POST /api/refill-food` — clears `food_spot` (bowl returns to the tray) and marks it
  full again, ready for next time.

Ephemeral, non-persisted client state: which sub-state of `ASLEEP/STIRRING/AWAKE_IDLE/
WALKING` the cat is currently animating through, and in-progress drag positions. This
is recomputed fresh each time a client loads — it's cosmetic and doesn't need to be
shared between simultaneous viewers.

## 9. Frontend Architecture

Vite + TypeScript, **vanilla** (no UI framework) — the scope is one scene with a
handful of elements, which doesn't warrant React/Vue overhead. Rough shape:

- A small local game loop (`requestAnimationFrame` or interval) driving the cat's
  client-side state machine and idle animations.
- Pointer-event drag handling for cat and food sprites: while dragging, the sprite
  snaps live to whichever spot (§6) is nearest the pointer, so the drag itself
  previews where it'll land rather than only snapping on drop.
- Sync with the backend: fetch `GET /api/state` on load, and after any action that
  changes persisted state (feed, move-cat, place-food); no continuous polling needed
  since this isn't a real-time multiplayer game.

## 10. Out of Scope for v1

Ideas worth keeping in mind but deliberately deferred:

- Food depletes slowly rather than being consumed in one go
- Old food needs to be cleared before we can feed
- "Resource management" - shopping and boiling food. Different kinds of food
- Push notifications / reminders
- Day/night cycle
- History graph of hunger/weight over time

## 11. Open Tuning Parameters

Not design decisions so much as numbers to adjust after actually playing with it:

- Hunger rise rate, feed amount, weight decay/gain rate (§3)
- Stir/wake frequency curve vs. hunger (§4)
- Exact spot pixel coordinates as the background art gets refined (§6)
