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
No cron job is needed for the simulation itself — decay is purely a function of elapsed
time since `updated_at`, so it's just as correct computed lazily on request as on a
timer. The hunger-notification scheduler (§12) does add a real background timer to the
process, but only to decide when to *notify*, not to keep the simulation itself
correct.

- **Hunger** — `0` (full) to `100` (starving). Rises **+10/hour**. Each bite (§5) drops
  it by a fixed amount (`-24`), floored at 0 — a fresh bowl is three bites, so a
  genuinely starving cat working through the whole thing in one sitting drops by up to
  `-72`, rather than resetting to 0 in one go.
- **Weight** — `0` (too thin) to `100`, healthy band roughly `40–60`. Decays
  **-0.278/hour** on its own (metabolism/age — mirrors "he loses weight unless he
  eats"). Each bite adds a flat **+0.67**, capped at 100.

Both stats are pinned to real grams of chicken (see §5): a bite is **20g**, three per
60g bowl, and the cat needs **200g/day**. Weight gain-per-bite and weight decay-per-hour
are both expressed via the same conversion — **30g = 1 weight unit** (from the
`2.00–5.00 kg` scale display range, §6: 3kg spread over the 0–100 stat) — so eating
exactly 200g/day exactly cancels a day of decay: true metabolic equilibrium sits at
*literally* 200g/day, not just approximately. Likewise, `FEED_HUNGER_DROP` (24) is
picked so a full day's worth of organically-rising hunger (24h × 10/hour = 240) is
exactly discharged by 10 bites (200g) — "hunger fully managed" and "200g/day eaten"
describe the same thing.

These numbers are starting proposals, easy to retune after playtesting — the point is
the shape: weight trends down over roughly a week without feeding, hunger becomes
noticeable within a day, matching a "check in every several hours" cadence, and —
central to the feeding loop — the three natural playstyles land in different places:
only feeding reactively (around the hungry notification, §12) nets a calorie deficit and
slow weight loss; keeping the bowl stocked without actively encouraging him to eat nets
roughly maintenance; actively topping him up (poking, refilling more often) nets a
surplus and weight gain. See §6 for how "roughly maintenance" is made to actually work
even when the app is mostly closed between visits.

Hunger tiers drive both the hunger-bar color and how he behaves around food (§4):

| Hunger | Tier | Bar color |
|---|---|---|
| 0–15 | Not hungry — won't eat, even offered directly | (normal) |
| 15–40 | Not very hungry — won't eat on his own, but will if poked | (normal) |
| 40–70 | Hungry — eats one bite on noticing food, then stops; a poke gets him another | warn |
| 70–100 | Very hungry — eats a bite on noticing food; a chance of a second on his own, but never a third without a poke | bad |

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

- **ASLEEP** (~99% of the time): stationary, deep sleep. On the same random timer,
  weighted so a hungrier cat is more active, one of two things can happen: a purely
  cosmetic twitch (a built-in, in-game "he wants food" cue — see §7 on why we're *not*
  doing push notifications for this), or — much rarer — he wakes up on his own, the
  same startled-awake transition a tap would trigger but silent (no meow, no thought
  bubble), landing in `LYINGDOWN` and immediately running the noticing-food check
  below. This is what lets a hungry-enough cat left alone long enough get up and find
  the bowl himself, rather than only ever waking when tapped. Otherwise exited by a tap
  (→ `LYINGDOWN`, startled) or a drag.
- **LYINGDOWN**: resting, alert-ish. Reached from `ASLEEP` (tapped → startled awake),
  from `SITTING` (settles back down after its hold timer), from `DRAGGED` (set down
  without being fed), or after eating. Auto-transitions to `ASLEEP` after ~2.5s via a
  "drifting off" animation unless tapped first, which instead sits him up.
- **SITTING**: upright and alert. Reached only by tapping a `LYINGDOWN` cat ("sits up"
  animation) — the most awake he gets without being handled directly. Auto-transitions
  back to `LYINGDOWN` after ~3s via a "sitting down" animation.
- **DRAGGED**: being held/moved by the player. Entered from `LYINGDOWN`, `SITTING`, or
  `ASLEEP` via a "picked up" animation; exited via a "released" animation the moment
  the player lets go, landing back in `LYINGDOWN` (see §6 for how drop position
  resolves to a spot) — regardless of which state he was in when picked up, a sleeping
  cat can be grabbed straight off the couch and will groggily go along with it, exactly
  like the real Toby. If the spot he lands on has food, landing in `LYINGDOWN` triggers
  the noticing check below rather than eating immediately.

**Noticing food**: an awake cat (`LYINGDOWN` or `SITTING`) whose spot matches a
non-empty bowl's spot notices it — checked at the two moments this can newly become
true: the food or the cat arriving at the other's spot (§5), and the cat waking up when
food was already sitting there (asleep cats don't notice; dragging doesn't count as
awake). On noticing, he sits up ("notice" reuses the sit-up animation) and pauses
briefly as if considering it, then resolves deterministically by hunger tier (§3): very
hungry or hungry eats a bite (§5); not very hungry or not hungry turns it down (a
"nope" animation) — before settling back to `SITTING` (not `LYINGDOWN` — from there he
follows the normal `SITTING` hold timer down). The food stays exactly where it was
either way. If he's still very hungry after that first bite and the bowl isn't empty,
there's a chance (`VERY_HUNGRY_SECOND_BITE_CHANCE`) he goes for a second one on his own
— but never a third; eating a whole bowl unprompted is meant to be the exception, not
the routine (§5).

**Poking for a bite**: tapping him while awake (`LYINGDOWN` or `SITTING`) and sitting
next to non-empty food is a separate check from noticing, and takes priority over the
tap's usual effect (waking/sitting up) — it always resolves to either an eating or a
"nope" animation instead. A not-hungry cat still turns it down; every other tier eats a
bite, which is how a hungry or very hungry cat (both limited to one, or occasionally
two, automatic bites on noticing) or a not very hungry one (no automatic bite at all)
can be topped up deliberately — poking (or dragging fresh food to him) is the reliable
way to get more into him beyond what he'll take on his own.

**Wandering**: three different moments each carry the same chance of sending him off to
a different, random spot instead of settling where he is — a poke that isn't about food
(above), and settling after eating a bite (§5) or after declining food (above). A
fourth moment is related but targeted rather than random: waking up (§4 above) to find
non-empty food waiting at a spot other than his own, gated by the same hunger tiers
that make him self-feed (§3), has a chance to send him straight to that food's spot
instead of a random one — so a hungry-enough cat left alone long enough doesn't just
wait for food to land in his lap, he can go find it himself. Whichever triggers it,
it's the same "sits up" animation, but instead of settling back down in place he
actually walks over, then settles `SITTING` at the new spot, running the usual
noticing-food check on arrival in case that spot happens to have food too. This also
means poking a `SITTING` cat is no longer always a no-op. The same
underlying idea happens unattended too, server-side: see §6 for the "he might've moved
while nobody was watching" mechanic (that version teleports rather than walking, since
there's no one there to see it).

The walk itself is direction-dependent, compared by the two spots' x-coordinates (§6):
heading toward larger x plays `startwalking-southeast.gif` (sit → stand into an
eastward gait) into a looping `walking-southeast.gif`; heading toward smaller x plays
`turning-southeast.gif` (sit east-facing → pivot through a front-on turn → walking-west
gait) into a looping `walking-southwest.gif`. Unlike every other transition, the
westward pair are genuine dedicated west-facing art, not a CSS mirror of the eastward
one — an earlier attempt at generating just the turn (leaving the walk cycle itself
mirrored) kept turning to show his *back* rather than pivoting to a mirrored profile,
which doesn't hand off cleanly into any walk cycle; a full dedicated westward pair
sidestepped that rather than fighting the generator further. Both lead-ins are
calibrated (via `assets_raw/reprocess_gif.py`) to hand off from the real
`sitting-southeast.png` bounding box and into their respective walk loop's, the same
way eat/nope/liedown already do.

Arrival plays the same two lead-ins in reverse — `stopwalking-southeast.gif` and
`stopturning-southeast.gif` — settling him back down to `SITTING` the same way he got
going, rather than cutting straight from mid-stride to the static pose (the westward
one has the nice side effect of turning him back to face into the room rather than
leaving him facing wherever he walked in from). These are generated once, mechanically,
by `assets_raw/reverse_gif.py` reversing the already-calibrated forward clips' frame
order — no new AI art or recalibration needed, since a bounding box reversed is still
the same bounding box at each end.

Transitions otherwise only exist for one facing (southeast); the mirrored facing
(southwest) is a CSS horizontal flip, not a separate asset (see §7) — the walk pair
above is the one deliberate exception.

Petting is the other interaction for an awake cat (below); the tooltip on the cat
sprite switches between "Tap to wake him" (asleep) and "Pet him!" (lying down or
sitting) to match.

**Petting**: a gesture that moves but stays within a small radius of his current spot
(more than a tap, not far enough to count as picking him up) loops a purr for as long
as the pointer stays down, instead of starting a drag — he doesn't move. v1 is
sound-only regardless of state; no sprite change, no effect on the sleep timer. A real
drag only starts once the pointer travels past that radius, from wherever it is at
that point — the purr loop stops the instant that happens.

**Ambient sound**: on the same random timer as the asleep behaviors above, a cat
resting awake (`LYINGDOWN` or `SITTING`, not mid-transition) will occasionally purr or
meow to himself with a matching thought bubble — flavor only, no effect on any stat.
Unlike the silent self-wake and the silent cosmetic stir, this one does make noise; see
§7 for why that's still consistent with keeping an open tab from being noisy.

**Very hungry override**: while his hunger tier is `veryHungry` (§3), the ambient timer
above is short-circuited rather than just reweighted — he doesn't get a chance to stay
asleep or drift back off to `ASLEEP` at all. Checked `ASLEEP` is forced straight into the
startled-awake transition every tick instead of rolling `SELF_WAKE`; resting `LYINGDOWN`
defers its usual drift-off-to-sleep timer for as long as he stays very hungry, instead
resettling into `LYINGDOWN` indefinitely. The same tick also makes him visibly restless
(the cosmetic wiggle, at a much higher rate than the asleep stir) and meows with some
regularity, each with its own matching thought bubble — a much shorter average cadence
than the ordinary ambient purr/meow above, since a very hungry, unattended cat is the
one case the game deliberately wants to be naggy about. Loading the page while he's
already very hungry greets the player with an immediate meow instead of the usual silent
`ASLEEP` start (§9).

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
4. A fresh bowl holds three bites, **20g each (60g total)** — the cat needs roughly
   **200g/day** (§3) — drawn down one level per bite through four sprites — `full →
   half → almostempty → empty` — rather than disappearing or resetting; it stays
   exactly where it was placed regardless of level. When the cat's spot and the food's
   spot match and the cat is awake, whether and how many bites he takes is governed by
   his hunger tier and pokes (§4): an eating animation plays per bite, hunger drops and
   weight ticks up per §3 each time; a decline plays a "nope" animation and leaves the
   level untouched. Grams eaten are tracked per calendar day (`gramsToday`/
   `gramsYesterday`, §8) and shown in the header, so the player can see at a glance
   whether he's on track for the day.
5. Dragging the bowl (any level) back onto the tray returns it there and refills it to
   full, ready to be placed again.

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
| `scales` | On the kitchen scale, bottom-left corner |

This list is easy to extend later — adding a spot is just picking a new pixel
coordinate on the background, no new art or mechanics.

`scales` is a special case: the player can drag the cat there like any other spot, but
he never ends up there through any self-directed movement — not the random wandering
below, and not the wander-to-food case in §4, even if a bowl happens to be sitting on
the scale. Every other spot is fair game for both.

Dropping him on the scale shows a live readout over the scale's built-in LED display
(baked into the background art) with his current weight — the `0–100` weight stat
mapped onto a plausible `2.00–5.00 kg` range rather than shown as a raw number. Once
he's settled, a thought bubble reacts to the reading with one of four flavor verdicts
(too thin, could eat more, healthy and pleased, or thoroughly chonky), then — after a
short beat to actually let the reading sink in — he wanders off to a random other spot
(§4's random wander, minus the targeting) exactly like an unprompted wander, same as he
never walks *onto* the scale on his own (above). The readout (and the verdict bubble)
stay up for a few seconds even after he's left, so nobody has to read them mid-stride.
This is purely a display, layered client-side on top of the shared `weight` stat — it
doesn't change how weight is simulated (§3). It's also now the *only* way to check
in on his weight: the header no longer has a running weight bar next to hunger, on the
theory that a real cat's weight isn't something you eyeball continuously either — you
put him on the scale. Hunger keeps its always-visible bar; weight doesn't.

**Wandering while unwatched**: besides moves the player makes directly, `cat_spot` can
also change server-side on its own — a chance, scaled by elapsed wall-clock time the
same way hunger/weight decay is (§3), that he's moved to a different spot during a gap.
This is only ever rolled on a genuinely fresh page load (the client marks that first
`GET /api/state` specially — see §8), never on an already-open tab's periodic
background poll, precisely so nobody watching the scene sees him teleport live — he can
only ever have moved *between* visits, the same way a real cat wanders off while you're
not in the room. See §4 for the other half of this (a poke-triggered version, animated
client-side).

**Self-feeding while unwatched**: the in-game "notices food and eats" behavior (§4) is
otherwise entirely client-side, driven by a timer that only runs while a tab is open —
so on its own, leaving a bowl out and closing the app would never get eaten from, no
matter how long the gap, which defeats "keep food available" as a real passive
strategy for someone mostly checking in from a phone (§3). To fix this, the same
fresh-load reconciliation that rolls the wander chance above also rolls a chance he
found and ate from an available bowl at some point during the gap — a single trial
scaled by elapsed hours and current hunger, same reasoning as the wander roll (he either
found it once during the gap or he didn't, not modeled as multiple discrete visits),
only possible once he's at least "hungry" (§3) and only if food is out and non-empty. If
it resolves, it takes 1 bite, with a chance of a 2nd — capped there, same as the
in-session noticing behavior (§4): a whole bowl going unprompted, even across an
unattended gap, should stay rare. It applies the usual hunger/weight/grams effect per
bite (§3), and repositions him at the bowl's spot before the wander roll runs — so he
can still end up somewhere else afterward, same as after a deliberate feed (§4). Both
rolls only ever fire on a fresh load, for the same reason: nobody watching an open tab
should see him suddenly have eaten.

A single illustrated background image (the room from §6, furniture included), a cat
sprite, a food bowl sprite (full/half/almostempty/empty). Animation via a small hand-drawn sprite sheet
per cat state (asleep, stirring/meow, idle, walk, eat) stepped with CSS, rendered as
absolutely positioned DOM elements rather than canvas — one character and one prop
over a static background is still cheap enough that DOM+CSS is simpler to build and
art-direct than a canvas renderer.

Beyond the in-game "stirs and meows more when hungry" behavior (§4), a real phone
notification nudges you back in when he's been very hungry for a while — see §12.

**Sound**: a meow plays on deliberate player actions (tapping the cat), and a purr
plays when he's successfully fed. The passive cosmetic stir and the silent self-wake
(§4) never make noise on their own, so an idle open tab doesn't start meowing out of
nowhere — the one deliberate exception is the low-frequency ambient purr/meow (§4)
while he's resting awake, which is the "ambient" case worth actually hearing
occasionally. A mute toggle in the header persists to `localStorage` (a device-local
preference, not part of the shared game state).

## 8. Persistence & API

Backend: **Node.js + Express + SQLite**, a single Express process that also serves the
built Vite static assets — one process, one port, nothing to orchestrate. No auth.

Uses `node:sqlite` (Node's built-in SQLite module, stable as of Node 22.5+) rather than
a third-party driver like `better-sqlite3` — same synchronous API shape, but no native
addon to compile, which matters since `better-sqlite3`'s prebuilt binaries and native
build can lag behind the newest Node versions.

Single-row table `game_state`:

```
hunger          REAL
weight          REAL
cat_spot        TEXT
food_spot       TEXT NULLABLE
food_level      TEXT   -- one of full / half / almostempty / empty
grams_today     REAL   -- grams eaten so far on day_key's calendar date
grams_yesterday REAL   -- grams eaten on the day before that
day_key         TEXT   -- local calendar date (YYYY-MM-DD) grams_today covers
updated_at      TIMESTAMP
```

`day_key` is compared against the current calendar date lazily, the same way
`updated_at` drives decay (§3) — no cron job needed here either: a fresh calculation
just rolls `grams_today` into `grams_yesterday` (or to 0, if more than one day has
passed unattended) whenever the date has moved on since the last update. This is a
narrow stat-tracking addition, not the "day/night cycle" idea listed as out of scope for
v1 (§10) — no in-game behavior changes based on time of day.

`cat_spot`/`food_spot` hold one of the spot ids from §6 (e.g. `"couch"`). The set of
valid spot ids is small and hand-authored, duplicated as a plain list in both the
client (for rendering/snapping) and the server (for validating incoming spot ids) —
not worth a shared package at this scale, just something to keep in sync by hand when
the spot list changes.

Endpoints:

- `GET /api/state?fresh=true` — applies elapsed-time decay to hunger/weight since
  `updated_at`, persists and returns the recomputed state (cat spot, food spot, hunger,
  weight). The `fresh=true` query param additionally rolls the wandering-while-unwatched
  chance (§6) into the same elapsed-time window; the client passes it only on the very
  first fetch after a page load, never on its periodic background poll (see §9).
- `POST /api/move-cat { spotId }` — updates `cat_spot` (so the cat is left wherever
  the last player dropped it). 400s if `spotId` isn't a known spot.
- `POST /api/place-food { spotId }` — sets `food_spot` and sets `food_level` to `full`
  (a fresh bowl from the tray). Same spot validation as `move-cat`.
- `POST /api/feed` — feeds one bite if `food_spot` is set, equals `cat_spot`, and
  `food_level` isn't already `empty`; applies the hunger/weight update and steps
  `food_level` down one level (`food_spot` is left as-is — the bowl stays in the
  scene). Returns `{ fed, state }` either way.
- `POST /api/refill-food` — clears `food_spot` (bowl returns to the tray) and sets
  `food_level` back to `full`, ready for next time.

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
- Sync with the backend: fetch `GET /api/state?fresh=true` on load (the "fresh" flag
  is what allows the wandering-while-unwatched roll, §6), after any action that changes
  persisted state (feed, move-cat, place-food), and on a 2-minute background poll
  (`GET /api/state`, no `fresh` flag) so hunger/weight visibly creep along in a tab
  that's been left open — this isn't a real-time multiplayer game, so that poll is a
  freshness convenience rather than something the simulation depends on (§3).

## 10. Out of Scope for v1

Ideas worth keeping in mind but deliberately deferred:

- Old food needs to be cleared before we can feed
- "Resource management" - shopping and boiling food. Different kinds of food
- Day/night cycle
- History graph of hunger/weight over time

## 11. Open Tuning Parameters

Not design decisions so much as numbers to adjust after actually playing with it:

- Hunger rise rate, feed amount, weight decay/gain rate (§3) — currently anchored to
  200g/day as the literal maintenance target, with 30g = 1 weight unit
- Hunger tier thresholds (15/40/70) and bites per bowl (currently 3, 20g each) (§3/§5)
- Stir/self-wake frequency curve vs. hunger, and the ambient purr/meow rate (§4)
- Wander chance (§4, shared by the poke/eat/decline triggers), the separate
  wander-to-food-on-waking chance (§4), and the wandering-while-unwatched per-hour
  chance (§6)
- The gap self-feed chance/hunger-weighting and second-bite chance (§6) — this is what
  "keep food available, don't poke" actually nets per day in practice, and is the main
  lever if that playstyle needs to land closer to true maintenance
- `VERY_HUNGRY_SECOND_BITE_CHANCE` (client) and its server-side mirror
  `GAP_SELF_FEED_SECOND_BITE_CHANCE` (§4/§6) — how often a very hungry cat takes a
  second unprompted bite; both are hard-capped at 2 bites, never 3, by design rather
  than just tuned low
- Exact spot pixel coordinates as the background art gets refined (§6)
- The `2.00–5.00 kg` display range the scale readout maps the weight stat onto (§6)
- The hunger-notification check interval and renotify interval (§12)

## 12. Hunger Notifications

A real phone notification (Web Push) when he's been very hungry for a while, so
whoever's around gets pulled back in with some regularity — the async, no-accounts
model (§2) means nobody's watching continuously, and the in-game stir/meow cues (§4)
only help if someone already has the tab open.

Opt-in per device via a bell toggle in the header, next to the mute toggle — no
accounts, so a subscription is just a row keyed by the browser's own Push API
`endpoint` URL. Unlike the mute toggle, its on/off state is never cached in
`localStorage`; it's read live from the browser's actual subscription each load, since
permission can be revoked from outside the page (browser or OS settings) and a cached
flag would go stale.

Server-side, a background timer (independent of any tab being open — the whole point of
push) checks hunger on a fixed interval: the first time he crosses `VERY_HUNGRY_THRESHOLD`
(§3) it notifies immediately, then keeps renotifying on a fixed cadence for as long as
he stays above it and unfed, then goes quiet again the moment he's fed back down —
which also resets the timer, so the *next* hungry episode notifies immediately again
rather than waiting out a stale interval. The "last notified" timestamp lives on the
single shared `game_state` row rather than per-subscription — one shared clock, same as
hunger/weight themselves, so feeding him from either phone quiets notifications on both.

This is the one deliberate exception to §3's "no cron job needed": the simulation
itself still only needs lazy on-request decay, but *deciding when to notify* requires
something checking in the background regardless of whether anyone's looking.

Each subscription also carries a `notify_after` timestamp (default: none, i.e. eligible
immediately) that holds it out of sends entirely until that time — useful for
onboarding a device without an immediate notification if he's already hungry. There's
no in-app UI for this; it's set via `scripts/push-delay.mjs` against the running
server. Because the renotify cadence above is a single shared clock, a subscription
becoming eligible mid-cooldown waits for the next scheduled check rather than sending
that instant.

**Quiet hours:** no push is ever sent with an hour-of-day in `[23:00, 9:00)`, using the
server's own local time (there's no per-subscription timezone to key off of — same
one-shared-clock reasoning as the rest of this section). A hunger crossing that happens
during the window is simply skipped rather than queued: `last_hunger_notified_at` is
left untouched, so the first check after quiet hours ends finds the notification
already overdue and sends immediately, the same as any other stale interval.

**Manual pause:** a single kill switch (`notifications_paused` on the shared
`game_state` row) that, while set, silences sends to every subscriber regardless of
quiet hours or hunger — for taking the cat's notifications offline entirely (e.g.
travel, a broken feature) until deliberately turned back on. No in-app UI, by design
(§10-style admin backdoor): toggled via `scripts/push-pause.mjs` against
`/api/push/pause` / `/api/push/resume`, with `/api/push/pause-status` to check current
state.
