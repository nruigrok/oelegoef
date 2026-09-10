# Change Plan — from Toby (cat) to Oelegoef (dog)

Goal: turn this repo into a new persistent, browser-based virtual pet game in the spirit
of Tamagotchi, themed on Mo's real 9-year-old black labradoodle. It is based on the
existing `design.md` (the Toby cat game) and keeps its architecture: one shared pet, no
accounts, wall-clock simulation, drag interactions on named spots, Node + Express +
SQLite, Vite + vanilla TypeScript, Web Push notifications.

What changes beyond the theme: a **new scenery** (a garden with a swimming pool instead
of a living room) and **three daily care loops** instead of one:

| Loop | Target per day | Player action | Dog's own behaviour |
|---|---|---|---|
| Food | 3 bowls | Drag bowl to dog / dog to bowl | Eats the whole bowl, begs when hungry |
| Poop | 3 times | Scoop the poop from the lawn | Poops on the lawn when he needs to |
| Swim | at least 1 | Throw the ball into the pool | Jumps in, swims, fetches, shakes off |

Rewriting `design.md` is its own step (Step 2), so the design decisions are recorded
before code is changed to match them.

## 0. Starting point and assumptions

**What is in the repo now** (all still Toby-flavoured):

| Area | Files | Notes |
|---|---|---|
| Design | `design.md` | Cat design, 12 sections, ~500 lines |
| Server | `server/src/{index,state,db,push,spots}.ts`, `server/scripts/*.mjs` | Single-row `game_state` table in `server/toby.db`, columns named `cat_spot` etc. |
| Client | `client/src/{main,api,spots}.ts`, `style.css`, `index.html`, `public/sw.js` | `main.ts` is ~1200 lines and holds the whole state machine |
| Art | `client/src/assets/cat/*` (4 static PNGs, 15 transition GIFs), `objects/bowl_*.png`, `background.jpg` | GIFs were calibrated with `assets_raw/reprocess_gif.py`, which is git-ignored and **not present** on this machine |
| Sound | `client/src/assets/sounds/{meow-1..3,purr,eating}.mp3` | |
| Tooling | `tools/gen_animation_overview.py` → `animation-overview.html` | Needs ffmpeg + Pillow |

**Assumptions to confirm with Mo before Step 2** (the plan works with any answer, but
the design text and the numbers depend on them):

1. The dog's name. The repo is called `oelegoef`, so this plan uses **Oelegoef** as
   the name throughout. Also: which pronoun to use in the UI text.
2. Real weight and daily food. A labradoodle is typically 20–30 kg and eats roughly
   250–350 g of kibble per day. The simulation is anchored to real grams (§3 of the
   design), so the real numbers matter. Three meals a day is given.
3. Personality. The classic labrador side wins: always interested in food, eats a
   whole bowl if allowed, ball-obsessed, happy to see anyone, sleeps a fair bit at 9
   but is easily roused.
4. Scenery details. A garden with a swimming pool is given. To decide: is the pool a
   real in-ground pool, does the garden have a terrace, a dog bed outside, a back door
   into the house, a bin for the poop bags.
5. Art source. Toby's sprites were AI-generated then calibrated. The same route is
   assumed here, but a photo-based or hand-drawn route also works with the same file
   layout.

## 1. Rebrand the scaffolding (no behaviour change)

Purely mechanical renames so nothing still says "Toby" or "cat" where a person can see
it. Do this first so later steps don't have to carry the old names.

- `package.json` names: `toby` → `oelegoef`, `toby-client`, `toby-server` likewise.
- `server/src/db.ts`: database file `toby.db` → `oelegoef.db`. A new game starts with a
  fresh database, so **no migration** of the old cat state is needed and the schema can
  change freely in Step 4.
- `client/index.html`: `<title>`, the notify-toggle title, the sprite tooltips, the
  tray tooltip.
- `server/src/push.ts`: notification title/body (`"Toby heeft honger"` etc.), tag
  `toby-hungry`, and the VAPID `mailto:` contact.
- `client/public/sw.js`: default title and notification tag.
- `server/src/index.ts`: the startup log line.
- Favicons and apple-touch-icon in `client/public/` — replaced in Step 3 once there is
  dog art; leave the cat ones until then.
- Identifier rename `cat` → `dog` across client and server (`catEl`, `catSpot`,
  `moveCat`, `/api/move-cat`, `.cat` CSS class, `assets/cat/` folder →
  `assets/dog/`). Do this as one commit with `tsc --noEmit` as the check, before any
  behaviour edits, so the diff of Steps 4–6 stays about behaviour only.

Check: `npm run build` succeeds, `npx tsc --noEmit` in both workspaces is clean, and
`grep -ri toby` over `client/src server/src client/index.html client/public` returns
nothing.

## 2. Rewrite `design.md` for Oelegoef

Separate step, as requested. Keep the section numbering where the subject survives
(the code comments reference section numbers), add sections for the two new loops, and
rewrite the content. Section by section:

- **Title / intro / §1 Concept & Tone.** New premise. Toby's tension was *"he forgets
  food exists"*; a labradoodle's is the opposite: *"he never forgets, and would eat
  the whole bag."* The day has a rhythm: three meals, three poops to scoop, and at
  least one swim after a thrown ball. Oelegoef's job is to remind everyone, loudly,
  when any of those is overdue. Tone stays low-pressure and affectionate: no death, no
  failure state, a slightly greying dog who is still all enthusiasm.
- **§2 Players & State Model.** Unchanged in substance. Replace "cat" wording; note
  that Mo's household is the set of players. Persisted, shared truth grows to: dog
  spot, bowl spot and level, ball location, the poops lying on the lawn, the four
  stats, and the per-day counters.
- **§3 Stats & Simulation.** Four stats, each 0–100, all simulated lazily against
  wall-clock time exactly like hunger/weight today:

  | Stat | Rises by | Falls by | Tiers |
  |---|---|---|---|
  | `hunger` | time (5/h, so ~8 h between meals lands at "hungry") | each bite | same four bands as now |
  | `weight` | each bite | time | same, displayed on the scale |
  | `bowel` | time only (12.5/h, so it hits urgent about every 8 h → 3 poops a day) | to 0 on each poop | 0–60 fine, 60–85 needs to go soon, 85–100 urgent |
  | `restlessness` | time | to 0 on a swim | 0–50 calm, 50–80 wants to play, 80–100 pestering with the ball |

  Food proposal (to confirm against assumption 2): bite 30 g, bowl 90 g (3 bites,
  keeps the existing four bowl sprites), daily target 270 g = 3 bowls. Keep the
  identity "eating exactly the daily target exactly cancels a day of weight decay" and
  "a day's hunger rise is exactly discharged by a day's bites". `bowel` is
  deliberately **independent of feeding**: it is a pure clock, so he poops about three
  times a day whether or not he has been fed, and feeding him more or less does not
  change that. `restlessness` rises so one swim a day keeps him under "wants to play"
  most of the day; skipping a day puts him in "pestering" by the next morning.
  Scale display range 18.0–32.0 kg.

  Per-day counters `meals_today` (bowls finished), `poops_today`, `swims_today`
  roll over with the existing `day_key` mechanism, and yesterday's values are kept
  the way `grams_yesterday` is now.
- **§4 Behaviour (state machine).** Keep the four resting states (`ASLEEP`,
  `LYINGDOWN`, `SITTING`, `DRAGGED`) and the one-shot transitions, and add two
  self-contained sequences: `POOPING` and `SWIMMING` (see §5b/§5c). Hunger tiers keep
  the same bands but the behaviour changes:
  - Not hungry (0–15): declines food ("nope" animation). The only refusing tier.
  - Not very hungry (15–40): eats if offered, doesn't go looking.
  - Hungry (40–70): eats on noticing and keeps going until the bowl is empty. Remove
    the "never a third bite" cap.
  - Very hungry (70–100): as hungry, plus goes and finds any bowl in the garden on
    waking, every time (wander-to-food chance 1.0).
  - "Poking" becomes petting-plus-encouragement. Ambient sounds: a tail thump, a sigh,
    a single "woef". Petting shows a tail-wag loop and plays panting instead of a purr.
  - Overrides, in priority order when several apply: urgent bowel → walks to the lawn
    and poops on his own (§5b); very hungry → whines and stands at the bowl spot, or
    at the back door if there is no bowl out; pestering restlessness → fetches the
    ball from wherever it is and drops it next to the player's tray, then sits at the
    pool edge staring at the water (§5c). Sleeps less than Toby: longer hold timers,
    higher self-wake chance.
- **§5 Feeding.** Same drag interaction and the same single bowl in the tray. Three
  meals a day: the header shows "Eten 2/3" from `meals_today`, plus grams today. A
  bowl counts as a meal when it reaches `empty`.
- **§5b Poop (new).** `bowel` crossing "urgent" (in session: on the ambient tick;
  unattended: rolled on a fresh load, like wandering) makes him walk to a random lawn
  spot, play a squat animation, and leave a poop object there; `bowel` resets to 0,
  `poops_today` increments. Poops are persisted (spot plus timestamp) and stay until
  scooped. The tray gets a scoop: drag the scoop onto a poop (or a poop onto the bin
  spot) to remove it. Neglect is flavour only: up to a cap of lying poops (say 5, the
  oldest disappears beyond that), flies drawn over old ones, and he refuses to lie on
  a lawn spot that has poop on it. The pool, terrace and bed never get poop.
- **§5c Swim (new).** A ball lives in the tray. Dragging it onto the `pool` spot
  throws it: he runs to the pool edge from wherever he is, jumps in (splash), swims a
  loop, climbs out with the ball, shakes off (spray), and is `wet` for a while
  (darker, dripping sprite variant; a wet dog dragged onto the bed or the terrace
  chairs gets a thought bubble, no stat effect). The ball goes back to the tray when
  he shakes off, so there is only ever one ball. `restlessness` resets, `swims_today`
  increments. Throwing the ball anywhere other than the pool is a plain fetch: he runs
  to it, brings it back, no swim, no reset. Dragging the dog straight into the pool
  also counts as a swim (some dogs need a push). The whole swim is client-side
  animation over one server call, so nobody can swim him unattended and the daily
  minimum genuinely needs a person.
- **§6 Garden & Spots.** New background art (Step 3): a garden with a swimming pool,
  a lawn, a terrace with a dog bed, the back door of the house, a bin, and a scale by
  the door. Proposed spots:

  | Spot | Dog can wander there | Bowl allowed | Poop allowed | Notes |
  |---|---|---|---|---|
  | `dog-bed` | yes | no | no | on the terrace |
  | `terrace` | yes | yes | no | where the bowl usually goes |
  | `back-door` | yes | yes | no | where he waits when hungry with no bowl out |
  | `lawn-left`, `lawn-right`, `lawn-far` | yes | yes | yes | poop targets |
  | `poolside` | yes | no | no | where he stares at the water |
  | `pool` | no (only via ball or drag) | no | no | in the water |
  | `bin` | no | no | no | scoop target only |
  | `scales` | no | no | no | weight readout, as now |

  Wander-while-unwatched and self-feed-while-unwatched mechanics stay, self-feed no
  longer capped at 2 bites. A new unattended roll: poop-while-unwatched (§5b).
- **§7 Art & Sound.** Restore the missing `## 7` header. Describe the dog sprite set,
  the facing convention (southeast drawn, southwest CSS-mirrored, walking pair
  dedicated), the wet variant, the object set (bowl ×4, ball, scoop, poop ×2 ages),
  the sound set (`woef`, `whine`, `pant`, `eating`, `splash`, `shake`).
- **§8 Persistence & API.** New schema and endpoints, see Step 4.
- **§9 Frontend.** Unchanged apart from names and the two new sequences.
- **§10 Out of scope.** Walks outside the garden, treats as a second food type,
  grooming, vet visits, history graph, weather/day-night, a second dog.
- **§11 Tuning parameters.** Regenerate from the new numbers; the three "per day"
  targets are the primary tuning goal (the bowel clock should produce ~3 poops a day
  on its own; one swim should hold restlessness for a day).
- **§12 Notifications.** Three reasons, one shared cadence and quiet hours (Step 6).

Check: every `design.md §n` reference in code comments still points at a section with
the same subject.

## 3. Art and sound assets

The client expects a fixed set of filenames and animation lengths. Replace each cat
file with a dog version and add the new ones:

- **Statics** (PNG, 80×80 box, `background-size: contain`, pixelated):
  `asleep`, `lyingdown`, `sitting`, `dragged` (southeast, plus southwest where a
  mirror is not enough), and `wet` variants of `sitting` and `lyingdown`.
- **Transition GIFs**, keeping each one's frame count and delay so the `*_DURATION_MS`
  constants in `main.ts` stay valid, or updating both together:
  `startled`, `driftoff`, `situp`, `liedown`, `picked-up`, `released`, `eat`, `nope`,
  `startwalking`, `stopwalking`, `walking-southeast`, `turning`, `stopturning`,
  `walking-southwest`. New: `tailwag` (loop, petting), `squat` (poop), `jump-in`,
  `swimming` (loop), `climb-out`, `shake-off`, `run` (loop, faster than walking, for
  fetching), `pick-up-ball`.
- **Objects**: `bowl_full/half/almostempty/empty.png` as a dog bowl; `ball.png`;
  `scoop.png`; `poop_fresh.png`, `poop_old.png`; `splash.gif` overlay for the pool.
- **Background**: the garden from §6, measured for the spot coordinates and the scale
  readout position; update `client/src/spots.ts` and the `SCALE_READOUT_*` constants.
  The pool needs a "water surface" band so the swimming sprite can sit half-submerged
  (a CSS clip on the sprite, or a foreground water strip drawn over it).
- **Sounds**: `woef-1..3.mp3`, `whine.mp3`, `pant.mp3` (petting loop), `eating.mp3`,
  `splash.mp3`, `shake.mp3`.
- **Icons**: favicon, apple-touch-icon.
- **Pipeline**: photos of the real dog and garden, turned into sprites with Pixellab
  (see below). Toby's `reprocess_gif.py` calibration step existed because each AI
  generated clip came on its own canvas and had to be re-aligned to the static
  poses; Pixellab exports every pose and frame of a character on the same fixed
  canvas with the same anchor, so that step goes away. Keep a small
  `assets_raw/` folder (committed this time) with the source photos, the Pixellab
  exports, and one script that converts sprite sheets to the GIF/PNG filenames the
  client expects, and document it in `design.md` §7.

### 3a. Photo and Pixellab workflow

**Photos to take** (daylight, phone is fine, no people in frame):

| Subject | Shots | Why |
|---|---|---|
| Dog | side view standing, sitting, lying down, asleep curled up, and a three-quarter view from the front-right | Pixellab's character reference; the side and three-quarter views define his silhouette |
| Dog | head close-up | the face, and the eye highlight that keeps a black dog readable at sprite size |
| Garden | one wide shot from a raised viewpoint (upstairs window or held high), showing the house wall, terrace, lawn and the pool in one frame | this becomes `background.jpg`, so it sets the spot layout |
| Garden | the dog bed, the back door, the bin, the scale where it will stand | to check every planned spot has a real landing place |
| Objects | bowl (empty and full), the ball, the scoop, three-quarter view from above | references for the object sprites |

**In Pixellab:**

1. Create the character from the dog photos. Pick the canvas size to match the
   game's sprite box: the client renders each sprite in an 80 px square with
   `image-rendering: pixelated`, so either generate at 80 px, or generate at 64 px
   and change the box (`CAT_SIZE_PX` in `main.ts`, `#cat` in `style.css`) to 64 or
   128 so the scale stays an integer and the pixels stay crisp.
2. Readability first: a black labradoodle at 64 px is a dark blob unless the fur has
   a lighter rim highlight and the eye and nose have contrast. Ask for a visible
   collar in a bright colour; it also gives the "wet" variant something to keep.
3. Generate the two facings the game uses, south-east and south-west, from the
   directional views. That replaces Toby's CSS mirror trick for the poses where a
   mirror looks wrong (the walk pair, eating from the bowl).
4. Animations, one per file in the list above: sleep (breathing), lie down, sit up,
   startle, walk, run, eat, nope (head turn), squat, tail wag, jump in, swim, climb
   out, shake off, pick up ball, picked up / released. Keep the frame count and
   frame delay noted per clip; they become the `*_DURATION_MS` constants.
5. Objects as small separate characters or with the pixel editor: bowl at four
   levels, ball, scoop, poop (fresh and old). 32 px canvas.
6. Wet variant: duplicate the sitting and lying poses, darken the fur, add drips.
7. Export every clip as a sprite sheet or GIF plus the static poses as PNG, with the
   transparent background kept.

**Background**: use the garden photo as `background.jpg` rather than generating
one. Reduce its detail so pixel sprites sit on it: downscale it to the scene's
rendered width, then either pixelate it to the same pixel size as the sprites (a
Pixellab style pass on the photo, or a plain nearest-neighbour downscale and upscale)
or leave it photographic but soften and slightly desaturate it. Try both on the
phone; the mixed look of pixel dog on soft photo is a legitimate choice. Then measure
the spot coordinates on it.

**Into the repo**: the conversion script writes the filenames the client imports,
checks each GIF's frame count and delay against a small table, and regenerates
`animation-overview.html` via `tools/gen_animation_overview.py` for a visual check.

Check: run `python3 tools/gen_animation_overview.py` (extended to include the new
sequences) and inspect `animation-overview.html`; every transition should hand off
cleanly between its start and end statics.

## 4. Server: state model, simulation and API

`server/src/db.ts`: fresh schema for `oelegoef.db`, no legacy columns and no
migration try/catch blocks.

```
game_state (single row)
  hunger, weight, bowel, restlessness   REAL
  dog_spot                              TEXT
  food_spot TEXT NULL, food_level TEXT
  ball_location                         TEXT   -- 'tray' or a spot id
  wet_until                             INTEGER NULL
  grams_today, grams_yesterday          REAL
  meals_today, meals_yesterday          INTEGER
  poops_today, poops_yesterday          INTEGER
  swims_today, swims_yesterday          INTEGER
  last_swim_at, last_poop_at            INTEGER NULL
  day_key, updated_at
  last_hunger_notified_at, last_poop_notified_at, last_swim_notified_at
  notifications_paused

poops
  id INTEGER PK, spot TEXT, created_at INTEGER
```

Seed row: hunger 20, weight 50, bowel 20, restlessness 30, `dog_spot = 'dog-bed'`,
ball in tray.

`server/src/state.ts`:

- Constants from Step 2 §3. Keep `GRAMS_PER_WEIGHT_UNIT` derived so equilibrium stays
  exact; add `BOWEL_RISE_PER_HOUR`, `BOWEL_URGENT_THRESHOLD`,
  `RESTLESSNESS_RISE_PER_HOUR`, `WET_DURATION_MS`. `applyBite()` touches hunger,
  weight, bowl level and grams only, never `bowel`.
- `getDecayedState`: also advance `bowel` and `restlessness`, roll the day counters,
  and on `fresh=true` roll, in this order: gap self-feed (uncapped), gap poop (if
  `bowel` crossed urgent during the gap: insert a poop at a random lawn spot, reset
  `bowel`, count it, move him there), wander.
- `rollGapSelfFeed`: remove the 2-bite cap in the hungry and very-hungry tiers.
- New functions: `poop()` (validates `bowel` ≥ urgent, inserts the poop, resets,
  counts), `scoop(id)`, `throwBall(spotId)` (sets `ball_location`), `swim()`
  (validates ball at pool or dog dragged to pool, resets `restlessness`, counts,
  sets `wet_until`, returns the ball to the tray, leaves him at `poolside`),
  `returnBall()`.
- Spot rules from the §6 table live in `server/src/spots.ts` (`WANDERABLE`,
  `BOWL_ALLOWED`, `POOP_ALLOWED` lists) and are mirrored in `client/src/spots.ts`.

`server/src/index.ts`, mirrored in `client/src/api.ts` and `scripts/debug-set.mjs`:

- Renamed: `POST /api/move-dog`.
- New: `POST /api/poop`, `POST /api/scoop { poopId }`, `POST /api/throw-ball
  { spotId }`, `POST /api/swim`, `POST /api/return-ball`.
- `GET /api/state` returns the poops list, ball location and counters alongside the
  existing fields.

Check: `npm run dev -w server`, then use `npm run debug -w server` to backdate
`updatedAt` by 14 hours with a full bowl out; the fresh-load path should eat the whole
bowl, deposit one poop on a lawn spot, and leave him at a plausible spot. Backdate 30
hours and confirm the counters rolled to yesterday.

## 5. Client: behaviour and the two new sequences

`client/src/main.ts`, keeping the state machine shape:

- Hunger tier logic per Step 2 §4; eating continues bite after bite while the bowl is
  non-empty in the hungry tiers.
- Ambient tick gains the override priority (bowel → hunger → restlessness) and the
  in-session poop trigger: walk to a lawn spot, `squat`, call `/api/poop`, render the
  new poop.
- `POOPING` and `SWIMMING` sequences as gated one-shots (the existing "busy" flag
  that blocks taps/drags mid-transition covers them).
- Swim choreography: ball dropped on `pool` → `/api/throw-ball` → run to `poolside`
  → `jump-in` + splash → `swimming` loop for a few seconds → `climb-out` →
  `shake-off` → `/api/swim` → wet sprites until `wet_until` → ball reappears in the
  tray. Ball dropped elsewhere → run there, `pick-up-ball`, run back to the tray
  side, `/api/return-ball`.
- Scoop: a second tray item; dragging it over a poop removes it (`/api/scoop`).
  Poops render as absolutely positioned objects like the bowl, switching to the old
  sprite after a few hours.
- Petting: `tailwag` loop and `pant`; stop both when the pointer lifts.
- Scale readout: new kg range and four Dutch verdict lines for a dog.
- Header: three daily counters ("Eten 2/3 · GoedZo 1/3 · Zwemmen 0/1"; the poop counter is labelled "GoedZo" in the UI) next to the
  hunger bar; all UI strings in Dutch, consistent with the current header.

`client/src/style.css`: sprite box size if the dog art needs more than 80 px; food and
ball offsets re-measured against the new art; a pool water-surface layer above the
sprite; a `.wet` modifier.

Check: `npx tsc --noEmit` clean; manual playtest on a phone covering: wake, pet, drag
dog to bowl, drag bowl to dog, refuse when not hungry, finish a bowl when hungry,
in-session poop and scoop, ball into pool and the full swim, ball onto the lawn (fetch
only), drag dog into pool, scale verdict, wander after eating, counters reset the next
day.

## 6. Notifications

`server/src/push.ts` grows from one reason to three, sharing the check interval, the
renotify cadence, quiet hours (23:00–09:00) and the pause/delay scripts:

| Reason | Trigger | Text (Dutch) |
|---|---|---|
| Hunger | `hunger` ≥ very hungry, as now | "Oelegoef heeft honger" |
| Poop lying around | a poop older than N hours is still on the lawn | "Er ligt nog een drol in de tuin" |
| No swim | `restlessness` ≥ pestering, or no swim by late afternoon | "Oelegoef wil zwemmen" |

One `last_*_notified_at` per reason so feeding him doesn't silence the swim reminder
and vice versa; at most one push per check so the phone gets one message, the most
urgent reason first. Tag per reason so they collapse separately on the device.

Check: subscribe one phone, backdate each stat with the debug script, run
`/api/push/check-now`, receive each of the three notifications.

## 7. Hosting and cut-over

**Where it runs (in place since 2026-09-10):** https://oelegoef.vanatteveldt.com on
`societal-analytics.labs.vu.nl`. Caddy (`/etc/caddy/Caddyfile`) terminates HTTPS and
proxies the domain to `localhost:3003`; systemd unit `oelegoef.service` runs
`node dist/index.js` from `/home/nel/oelegoef/server` as user `nel`, on Node 24
installed via nvm for that user (the system Node is 20, too old for `node:sqlite`).
DNS is a CNAME at Cloudflare to the VU host. The same box also runs Wouter's Toby
(`toby.service`, port 3001) and his earlier copy of this repo; the previous unit file
is kept as `oelegoef.service.wva.bak`.

- **Deploy** = `tools/deploy.sh`: pull `main`, `npm ci`, `npm run build`, restart the
  unit, curl-check. No CI; deploy by hand after pushing.
- **Right now the site is the mockup**: `mockup/index.html` (generated by
  `tools/wrap_mockup.py` from the Artifact page) is served ahead of the client build
  by `server/src/index.ts`. The Toby API and its `toby.db` still run underneath but
  nothing on the page calls them. Step 5 replaces this with the real client; drop the
  mockup route then.
- Start the real game with an empty `oelegoef.db`. VAPID keys are generated on first
  boot and stored in SQLite; back up the db file, because losing the keys orphans
  every subscription.
- Update `CLAUDE.md` with the run commands and the asset pipeline once Step 3 settles.

## 8. Deferred: walks outside the garden

With a garden, pooping and exercise both happen at home, so walks are not needed for
the three loops above. If wanted later: a leash in the tray, dragging it onto the dog
takes him out through the back door for a fixed wall-clock duration, resets
`restlessness` like a swim, and may count as a poop. Listed under `design.md` §10 in
Step 2.

## 9. Order and checkpoints

1. Step 1 (rebrand + identifier rename) — one commit, build green.
2. Step 2 (`design.md`) — one commit, reviewed by Mo before code changes.
3. Step 3 (art) can run in parallel with Steps 4–5; use the cat art and simple
   placeholder PNGs for ball/scoop/poop until the dog set is ready, since the
   filenames are the contract.
4. Step 4 (server) before Step 5 (client), since the client's new sequences depend on
   the new endpoints. Feeding first, then poop, then swim, each with its check.
5. Step 6 — notifications, once all three stats exist.
6. Step 7 — deploy, fresh database, one phone subscribed.

Definition of done for v1: the design document describes the dog game, no visible
string or asset still refers to Toby or a cat, the numbers in code match the tables
in `design.md` §3, a day produces about three poops regardless of feeding, three
bowls fill the meal counter, one thrown ball produces one swim and resets
restlessness, the playtest list in
Step 5 passes on a phone, and all three notification reasons have been received on a
real device.
