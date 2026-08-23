import { db } from "./db.js";
import type { SpotId } from "./spots.js";

export interface GameState {
  hunger: number;
  weight: number;
  catSpot: SpotId;
  foodSpot: SpotId | null;
  foodFull: boolean;
  updatedAt: number;
}

interface GameStateRow {
  hunger: number;
  weight: number;
  cat_spot: string;
  food_spot: string | null;
  food_full: number;
  updated_at: number;
}

// Tunable simulation parameters — see design.md §3 and §11.
const HUNGER_RISE_PER_HOUR = 5;
const WEIGHT_DECAY_PER_HOUR = 0.5;
const FEED_HUNGER_DROP = 70;
const FEED_WEIGHT_GAIN = 3;

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

function rowToState(row: GameStateRow): GameState {
  return {
    hunger: row.hunger,
    weight: row.weight,
    catSpot: row.cat_spot as SpotId,
    foodSpot: row.food_spot as SpotId | null,
    foodFull: !!row.food_full,
    updatedAt: row.updated_at,
  };
}

const selectRow = db.prepare("SELECT * FROM game_state WHERE id = 1");

const updateRow = db.prepare(
  `UPDATE game_state
   SET hunger = @hunger, weight = @weight, cat_spot = @catSpot,
       food_spot = @foodSpot, food_full = @foodFull, updated_at = @updatedAt
   WHERE id = 1`
);

function persist(state: GameState): GameState {
  updateRow.run({
    hunger: state.hunger,
    weight: state.weight,
    catSpot: state.catSpot,
    foodSpot: state.foodSpot,
    foodFull: state.foodFull ? 1 : 0,
    updatedAt: state.updatedAt,
  });
  return state;
}

/** Applies decay for elapsed wall-clock time since the last update, and persists the result. */
export function getDecayedState(): GameState {
  const state = rowToState(selectRow.get() as unknown as GameStateRow);
  const now = Date.now();
  const hoursElapsed = (now - state.updatedAt) / (1000 * 60 * 60);

  if (hoursElapsed <= 0) return state;

  return persist({
    ...state,
    hunger: clamp(state.hunger + HUNGER_RISE_PER_HOUR * hoursElapsed),
    weight: clamp(state.weight - WEIGHT_DECAY_PER_HOUR * hoursElapsed),
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
  return persist({ ...state, foodSpot: spotId, foodFull: true });
}

/** Sends the bowl back to the tray — where it's always available, full. */
export function refillFood(): GameState {
  const state = getDecayedState();
  return persist({ ...state, foodSpot: null, foodFull: true });
}

/** Testing-only backdoor to force hunger/weight/spots/bowl state directly — see /api/debug. */
export function debugSetState(patch: {
  hunger?: number;
  weight?: number;
  catSpot?: SpotId;
  foodSpot?: SpotId | null;
  foodFull?: boolean;
}): GameState {
  const state = getDecayedState();
  return persist({
    hunger: patch.hunger !== undefined ? clamp(patch.hunger) : state.hunger,
    weight: patch.weight !== undefined ? clamp(patch.weight) : state.weight,
    catSpot: patch.catSpot ?? state.catSpot,
    foodSpot: patch.foodSpot !== undefined ? patch.foodSpot : state.foodSpot,
    foodFull: patch.foodFull ?? state.foodFull,
    updatedAt: Date.now(),
  });
}

export function eatFood(): { fed: boolean; state: GameState } {
  const state = getDecayedState();

  if (state.foodSpot === null || state.foodSpot !== state.catSpot || !state.foodFull) {
    return { fed: false, state };
  }

  // The bowl stays put, now empty — it isn't cleared until dragged back to the tray.
  const fed = persist({
    ...state,
    hunger: clamp(state.hunger - FEED_HUNGER_DROP),
    weight: clamp(state.weight + FEED_WEIGHT_GAIN),
    foodFull: false,
  });
  return { fed: true, state: fed };
}
