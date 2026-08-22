import { db } from "./db.js";

export interface GameState {
  hunger: number;
  weight: number;
  catX: number;
  catY: number;
  foodX: number | null;
  foodY: number | null;
  updatedAt: number;
}

interface GameStateRow {
  hunger: number;
  weight: number;
  cat_x: number;
  cat_y: number;
  food_x: number | null;
  food_y: number | null;
  updated_at: number;
}

// Tunable simulation parameters — see design.md §3 and §10.
const HUNGER_RISE_PER_HOUR = 5;
const WEIGHT_DECAY_PER_HOUR = 0.5;
const FEED_HUNGER_DROP = 70;
const FEED_WEIGHT_GAIN = 3;
export const FEED_PROXIMITY_THRESHOLD = 12; // in the same 0-100 coordinate units as cat_x/food_x

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

function rowToState(row: GameStateRow): GameState {
  return {
    hunger: row.hunger,
    weight: row.weight,
    catX: row.cat_x,
    catY: row.cat_y,
    foodX: row.food_x,
    foodY: row.food_y,
    updatedAt: row.updated_at,
  };
}

const selectRow = db.prepare("SELECT * FROM game_state WHERE id = 1");

const updateRow = db.prepare(
  `UPDATE game_state
   SET hunger = @hunger, weight = @weight, cat_x = @catX, cat_y = @catY,
       food_x = @foodX, food_y = @foodY, updated_at = @updatedAt
   WHERE id = 1`
);

function persist(state: GameState): GameState {
  updateRow.run({
    hunger: state.hunger,
    weight: state.weight,
    catX: state.catX,
    catY: state.catY,
    foodX: state.foodX,
    foodY: state.foodY,
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

export function moveCat(x: number, y: number): GameState {
  const state = getDecayedState();
  return persist({ ...state, catX: clamp(x), catY: clamp(y) });
}

export function placeFood(x: number, y: number): GameState {
  const state = getDecayedState();
  return persist({ ...state, foodX: clamp(x), foodY: clamp(y) });
}

export function tryFeed(): { fed: boolean; state: GameState } {
  const state = getDecayedState();

  if (state.foodX === null || state.foodY === null) {
    return { fed: false, state };
  }

  const distance = Math.hypot(state.catX - state.foodX, state.catY - state.foodY);
  if (distance > FEED_PROXIMITY_THRESHOLD) {
    return { fed: false, state };
  }

  const fed = persist({
    ...state,
    hunger: clamp(state.hunger - FEED_HUNGER_DROP),
    weight: clamp(state.weight + FEED_WEIGHT_GAIN),
    foodX: null,
    foodY: null,
  });
  return { fed: true, state: fed };
}
