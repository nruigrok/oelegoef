import { db } from "./db.js";
import { WANDERABLE_SPOT_IDS, type SpotId } from "./spots.js";

// How much food is left in the bowl — a fresh bowl holds three bites, emptying
// one level per feed (see design.md §5).
export const FOOD_LEVELS = ["full", "half", "almostempty", "empty"] as const;
export type FoodLevel = (typeof FOOD_LEVELS)[number];

export function isValidFoodLevel(value: unknown): value is FoodLevel {
  return typeof value === "string" && (FOOD_LEVELS as readonly string[]).includes(value);
}

function nextFoodLevel(level: FoodLevel): FoodLevel {
  const idx = FOOD_LEVELS.indexOf(level);
  return FOOD_LEVELS[Math.min(idx + 1, FOOD_LEVELS.length - 1)];
}

export interface GameState {
  hunger: number;
  weight: number;
  catSpot: SpotId;
  foodSpot: SpotId | null;
  foodLevel: FoodLevel;
  gramsToday: number;
  gramsYesterday: number;
  dayKey: string;
  updatedAt: number;
}

interface GameStateRow {
  hunger: number;
  weight: number;
  cat_spot: string;
  food_spot: string | null;
  food_level: string;
  grams_today: number;
  grams_yesterday: number;
  day_key: string;
  updated_at: number;
}

// Tunable simulation parameters — see design.md §3 and §11. Weight and hunger are both
// pinned to real grams of chicken: a bite is 40g (three per 120g bowl), and the cat
// needs 200g/day. FEED_WEIGHT_GAIN and WEIGHT_DECAY_PER_HOUR are both expressed via the
// same grams-per-weight-unit conversion (30g/unit, taken from weightToKg()'s existing
// 2-5kg display range in client/src/main.ts — 3kg over the 0-100 stat), so eating
// exactly the daily target exactly cancels a day of decay: true equilibrium sits at
// 200g/day, not just approximately.
const BITE_GRAMS = 40;
const DAILY_TARGET_GRAMS = 200;
const GRAMS_PER_WEIGHT_UNIT = 30;
const HUNGER_RISE_PER_HOUR = 5;
const FEED_HUNGER_DROP = 24;
const FEED_WEIGHT_GAIN = BITE_GRAMS / GRAMS_PER_WEIGHT_UNIT;
const WEIGHT_DECAY_PER_HOUR = DAILY_TARGET_GRAMS / GRAMS_PER_WEIGHT_UNIT / 24;
// Chance he's wandered to a different spot, scaled by elapsed hours the same way as
// hunger/weight — see rollWander() and design.md §4/§6. Only ever rolled on a "fresh"
// state fetch (a new page load), never on an already-open tab's periodic poll, so
// nobody sees him teleport live — see getDecayedState().
const WANDER_CHANCE_PER_HOUR = 0.15;
// Chance he's found and eaten from an available bowl during an unattended gap — see
// rollGapSelfFeed() and design.md §6. Gated the same way WANDER_CHANCE_PER_HOUR is
// (fresh loads only), for the same reason.
const GAP_SELF_FEED_BASE_CHANCE_PER_HOUR = 0.1;
const GAP_SELF_FEED_HUNGER_WEIGHT = 0.2;
// Chance of a 2nd bite once he's found the bowl — capped there, never a 3rd, mirroring
// the client's VERY_HUNGRY_SECOND_BITE_CHANCE cap: polishing off a whole bowl
// unprompted (even across an unattended gap) should be the exception, not the routine.
const GAP_SELF_FEED_SECOND_BITE_CHANCE = 0.3;
// Mirrors client/src/main.ts's HUNGRY_THRESHOLD/VERY_HUNGRY_THRESHOLD (design.md §3) —
// duplicated the same way spot ids are (design.md §8: "not worth a shared package at
// this scale"). VERY_HUNGRY_THRESHOLD is used by push.ts to decide when to notify;
// HUNGRY_THRESHOLD gates rollGapSelfFeed() the same way selfFeedsAtTier() gates
// self-feeding client-side.
const HUNGRY_THRESHOLD = 40;
export const VERY_HUNGRY_THRESHOLD = 70;

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

/** Treats the gap as a single Bernoulli trial scaled by elapsed hours — he either
 * wandered once during the gap or he didn't; good enough at these small probabilities
 * without modeling multiple hops. */
function rollWander(currentSpot: SpotId, hoursElapsed: number): SpotId {
  const chance = 1 - Math.pow(1 - WANDER_CHANCE_PER_HOUR, hoursElapsed);
  if (Math.random() >= chance) return currentSpot;
  const others = WANDERABLE_SPOT_IDS.filter((id) => id !== currentSpot);
  return others[Math.floor(Math.random() * others.length)];
}

function rowToState(row: GameStateRow): GameState {
  return {
    hunger: row.hunger,
    weight: row.weight,
    catSpot: row.cat_spot as SpotId,
    foodSpot: row.food_spot as SpotId | null,
    foodLevel: row.food_level as FoodLevel,
    gramsToday: row.grams_today,
    gramsYesterday: row.grams_yesterday,
    dayKey: row.day_key,
    updatedAt: row.updated_at,
  };
}

const selectRow = db.prepare("SELECT * FROM game_state WHERE id = 1");

const updateRow = db.prepare(
  `UPDATE game_state
   SET hunger = @hunger, weight = @weight, cat_spot = @catSpot,
       food_spot = @foodSpot, food_level = @foodLevel,
       grams_today = @gramsToday, grams_yesterday = @gramsYesterday, day_key = @dayKey,
       updated_at = @updatedAt
   WHERE id = 1`
);

function persist(state: GameState): GameState {
  updateRow.run({
    hunger: state.hunger,
    weight: state.weight,
    catSpot: state.catSpot,
    foodSpot: state.foodSpot,
    foodLevel: state.foodLevel,
    gramsToday: state.gramsToday,
    gramsYesterday: state.gramsYesterday,
    dayKey: state.dayKey,
    updatedAt: state.updatedAt,
  });
  return state;
}

/** Local calendar date the given instant falls on, e.g. "2026-08-25" — used to detect
 * when gramsToday/gramsYesterday need to roll over. See getDecayedState(). */
function dayKeyFor(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function previousDayKey(ms: number): string {
  return dayKeyFor(ms - 24 * 60 * 60 * 1000);
}

interface BiteEffect {
  hunger: number;
  weight: number;
  foodLevel: FoodLevel;
  gramsToday: number;
}

/** The hunger/weight/bowl-level/grams-tracking effect of a single bite — shared by a
 * deliberate feed (eatFood()) and an unattended one found during a gap
 * (rollGapSelfFeed()) so the math only lives in one place. */
function applyBite(input: BiteEffect): BiteEffect {
  return {
    hunger: clamp(input.hunger - FEED_HUNGER_DROP),
    weight: clamp(input.weight + FEED_WEIGHT_GAIN),
    foodLevel: nextFoodLevel(input.foodLevel),
    gramsToday: input.gramsToday + BITE_GRAMS,
  };
}

/**
 * Whether/how much he found and ate from an available bowl at some point during an
 * unattended gap — a single Bernoulli trial scaled by elapsed hours, same reasoning as
 * rollWander(): he either found it at some point during the gap or he didn't, not
 * modeled as multiple discrete visits. Requires food out and non-empty, and only
 * applies once hunger (after the elapsed-time rise) is at least "hungry" — mirrors
 * selfFeedsAtTier() client-side. Capped at 2 bites, same as the client's
 * VERY_HUNGRY_SECOND_BITE_CHANCE cap — never a whole bowl unprompted. See design.md §6.
 */
function rollGapSelfFeed(state: GameState, hoursElapsed: number, hungerAfterDecay: number): number {
  if (state.foodSpot === null || state.foodLevel === "empty") return 0;
  if (hungerAfterDecay <= HUNGRY_THRESHOLD) return 0;
  const rate = GAP_SELF_FEED_BASE_CHANCE_PER_HOUR + (hungerAfterDecay / 100) * GAP_SELF_FEED_HUNGER_WEIGHT;
  const chance = 1 - Math.pow(1 - rate, hoursElapsed);
  if (Math.random() >= chance) return 0;
  const availableBites = FOOD_LEVELS.length - 1 - FOOD_LEVELS.indexOf(state.foodLevel);
  const maxBites = Math.min(2, availableBites);
  return maxBites > 1 && Math.random() < GAP_SELF_FEED_SECOND_BITE_CHANCE ? 2 : 1;
}

/**
 * Applies decay for elapsed wall-clock time since the last update, and persists the
 * result. With `allowWander`, also rolls a chance he's moved to a different spot on
 * his own during that gap (see design.md §4), and — if food's been left out — a chance
 * he found and ate from it during the gap too (see rollGapSelfFeed(), design.md §6).
 * Pass `allowWander` only for a fresh page load, never for a poll against a tab that's
 * already open and being watched.
 *
 * Also rolls the calendar-day boundary forward lazily, same spirit as the rest of the
 * decay: gramsToday/gramsYesterday are recomputed on request rather than via a timer.
 */
export function getDecayedState(opts: { allowWander?: boolean } = {}): GameState {
  const state = rowToState(selectRow.get() as unknown as GameStateRow);
  const now = Date.now();
  const hoursElapsed = (now - state.updatedAt) / (1000 * 60 * 60);

  const todayKey = dayKeyFor(now);
  let gramsToday = state.gramsToday;
  let gramsYesterday = state.gramsYesterday;
  const dayRolled = todayKey !== state.dayKey;
  if (dayRolled) {
    // Exactly one day advanced → gramsToday was that day's real total. A bigger gap
    // (app not opened for a while) means the most recently *finished* day had nothing
    // recorded for it — 0g, not whatever gramsToday happened to be several days ago.
    gramsYesterday = state.dayKey === previousDayKey(now) ? gramsToday : 0;
    gramsToday = 0;
  }

  if (hoursElapsed <= 0 && !dayRolled) return state;

  const elapsed = Math.max(hoursElapsed, 0);
  let hunger = clamp(state.hunger + HUNGER_RISE_PER_HOUR * elapsed);
  let weight = state.weight;
  let foodLevel = state.foodLevel;
  let catSpot = state.catSpot;

  if (opts.allowWander && elapsed > 0) {
    const bites = rollGapSelfFeed(state, elapsed, hunger);
    for (let i = 0; i < bites; i++) {
      ({ hunger, weight, foodLevel, gramsToday } = applyBite({ hunger, weight, foodLevel, gramsToday }));
    }
    if (bites > 0) catSpot = state.foodSpot!;
  }

  weight = clamp(weight - WEIGHT_DECAY_PER_HOUR * elapsed);
  catSpot = opts.allowWander ? rollWander(catSpot, elapsed) : catSpot;

  return persist({
    hunger,
    weight,
    catSpot,
    foodSpot: state.foodSpot,
    foodLevel,
    gramsToday,
    gramsYesterday,
    dayKey: todayKey,
    updatedAt: now,
  });
}

export function moveCat(spotId: SpotId): GameState {
  const state = getDecayedState();
  return persist({ ...state, catSpot: spotId });
}

export function placeFood(spotId: SpotId): GameState {
  const state = getDecayedState();
  // A bowl placed from the tray is always a fresh, full one.
  return persist({ ...state, foodSpot: spotId, foodLevel: "full" });
}

/** Repositions an already-placed bowl without refilling it. */
export function moveFood(spotId: SpotId): GameState {
  const state = getDecayedState();
  return persist({ ...state, foodSpot: spotId });
}

/** Sends the bowl back to the tray — where it's always available, full. */
export function refillFood(): GameState {
  const state = getDecayedState();
  return persist({ ...state, foodSpot: null, foodLevel: "full" });
}

/**
 * Testing-only backdoor to force hunger/weight/spots/bowl/grams state directly — see
 * /api/debug. `updatedAt` can be backdated to simulate an elapsed gap (e.g. to exercise
 * rollGapSelfFeed() or a day rollover) without waiting for real time to pass — the next
 * fresh getDecayedState() call picks it up exactly as if that much time had really
 * elapsed, dayKey included, since it's set here from `updatedAt` rather than `now`.
 */
export function debugSetState(patch: {
  hunger?: number;
  weight?: number;
  catSpot?: SpotId;
  foodSpot?: SpotId | null;
  foodLevel?: FoodLevel;
  gramsToday?: number;
  gramsYesterday?: number;
  updatedAt?: number;
}): GameState {
  const state = getDecayedState();
  const updatedAt = patch.updatedAt !== undefined ? patch.updatedAt : Date.now();
  return persist({
    hunger: patch.hunger !== undefined ? clamp(patch.hunger) : state.hunger,
    weight: patch.weight !== undefined ? clamp(patch.weight) : state.weight,
    catSpot: patch.catSpot ?? state.catSpot,
    foodSpot: patch.foodSpot !== undefined ? patch.foodSpot : state.foodSpot,
    foodLevel: patch.foodLevel ?? state.foodLevel,
    gramsToday: patch.gramsToday !== undefined ? patch.gramsToday : state.gramsToday,
    gramsYesterday: patch.gramsYesterday !== undefined ? patch.gramsYesterday : state.gramsYesterday,
    dayKey: dayKeyFor(updatedAt),
    updatedAt,
  });
}

/** Feeds one bite (one bowl level) if the cat and a non-empty bowl share a spot. */
export function eatFood(): { fed: boolean; state: GameState } {
  const state = getDecayedState();

  if (state.foodSpot === null || state.foodSpot !== state.catSpot || state.foodLevel === "empty") {
    return { fed: false, state };
  }

  // The bowl stays put, one level emptier — it isn't cleared until dragged back to the tray.
  const bite = applyBite(state);
  const fed = persist({
    ...state,
    hunger: bite.hunger,
    weight: bite.weight,
    foodLevel: bite.foodLevel,
    gramsToday: bite.gramsToday,
  });
  return { fed: true, state: fed };
}
