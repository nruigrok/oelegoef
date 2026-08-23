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
  updatedAt: number;
}

interface GameStateRow {
  hunger: number;
  weight: number;
  cat_spot: string;
  food_spot: string | null;
  food_level: string;
  updated_at: number;
}

// Tunable simulation parameters — see design.md §3 and §11.
const HUNGER_RISE_PER_HOUR = 5;
const WEIGHT_DECAY_PER_HOUR = 0.5;
const FEED_HUNGER_DROP = 30;
const FEED_WEIGHT_GAIN = 3;
// Chance he's wandered to a different spot, scaled by elapsed hours the same way as
// hunger/weight — see rollWander() and design.md §4/§6. Only ever rolled on a "fresh"
// state fetch (a new page load), never on an already-open tab's periodic poll, so
// nobody sees him teleport live — see getDecayedState().
const WANDER_CHANCE_PER_HOUR = 0.15;

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
    updatedAt: row.updated_at,
  };
}

const selectRow = db.prepare("SELECT * FROM game_state WHERE id = 1");

const updateRow = db.prepare(
  `UPDATE game_state
   SET hunger = @hunger, weight = @weight, cat_spot = @catSpot,
       food_spot = @foodSpot, food_level = @foodLevel, updated_at = @updatedAt
   WHERE id = 1`
);

function persist(state: GameState): GameState {
  updateRow.run({
    hunger: state.hunger,
    weight: state.weight,
    catSpot: state.catSpot,
    foodSpot: state.foodSpot,
    foodLevel: state.foodLevel,
    updatedAt: state.updatedAt,
  });
  return state;
}

/**
 * Applies decay for elapsed wall-clock time since the last update, and persists the
 * result. With `allowWander`, also rolls a chance he's moved to a different spot on
 * his own during that gap — pass it only for a fresh page load (see design.md §4),
 * never for a poll against a tab that's already open and being watched.
 */
export function getDecayedState(opts: { allowWander?: boolean } = {}): GameState {
  const state = rowToState(selectRow.get() as unknown as GameStateRow);
  const now = Date.now();
  const hoursElapsed = (now - state.updatedAt) / (1000 * 60 * 60);

  if (hoursElapsed <= 0) return state;

  return persist({
    ...state,
    hunger: clamp(state.hunger + HUNGER_RISE_PER_HOUR * hoursElapsed),
    weight: clamp(state.weight - WEIGHT_DECAY_PER_HOUR * hoursElapsed),
    catSpot: opts.allowWander ? rollWander(state.catSpot, hoursElapsed) : state.catSpot,
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

/** Sends the bowl back to the tray — where it's always available, full. */
export function refillFood(): GameState {
  const state = getDecayedState();
  return persist({ ...state, foodSpot: null, foodLevel: "full" });
}

/** Testing-only backdoor to force hunger/weight/spots/bowl state directly — see /api/debug. */
export function debugSetState(patch: {
  hunger?: number;
  weight?: number;
  catSpot?: SpotId;
  foodSpot?: SpotId | null;
  foodLevel?: FoodLevel;
}): GameState {
  const state = getDecayedState();
  return persist({
    hunger: patch.hunger !== undefined ? clamp(patch.hunger) : state.hunger,
    weight: patch.weight !== undefined ? clamp(patch.weight) : state.weight,
    catSpot: patch.catSpot ?? state.catSpot,
    foodSpot: patch.foodSpot !== undefined ? patch.foodSpot : state.foodSpot,
    foodLevel: patch.foodLevel ?? state.foodLevel,
    updatedAt: Date.now(),
  });
}

/** Feeds one bite (one bowl level) if the cat and a non-empty bowl share a spot. */
export function eatFood(): { fed: boolean; state: GameState } {
  const state = getDecayedState();

  if (state.foodSpot === null || state.foodSpot !== state.catSpot || state.foodLevel === "empty") {
    return { fed: false, state };
  }

  // The bowl stays put, one level emptier — it isn't cleared until dragged back to the tray.
  const fed = persist({
    ...state,
    hunger: clamp(state.hunger - FEED_HUNGER_DROP),
    weight: clamp(state.weight + FEED_WEIGHT_GAIN),
    foodLevel: nextFoodLevel(state.foodLevel),
  });
  return { fed: true, state: fed };
}
