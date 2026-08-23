export type FoodLevel = "full" | "half" | "almostempty" | "empty";

export interface GameState {
  hunger: number;
  weight: number;
  catSpot: string;
  foodSpot: string | null;
  foodLevel: FoodLevel;
  updatedAt: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // `fresh` should only be true for a brand-new page load — it lets the server roll a
  // chance the cat's wandered to a new spot while nobody was watching (see design.md
  // §4). Never pass it for a poll against a tab that's already open.
  getState: (fresh = false) => request<GameState>(fresh ? "/api/state?fresh=true" : "/api/state"),

  moveCat: (spotId: string) =>
    request<GameState>("/api/move-cat", {
      method: "POST",
      body: JSON.stringify({ spotId }),
    }),

  placeFood: (spotId: string) =>
    request<GameState>("/api/place-food", {
      method: "POST",
      body: JSON.stringify({ spotId }),
    }),

  feed: () =>
    request<{ fed: boolean; state: GameState }>("/api/feed", {
      method: "POST",
    }),

  refillFood: () =>
    request<GameState>("/api/refill-food", {
      method: "POST",
    }),

  debugSet: (patch: {
    hunger?: number;
    weight?: number;
    catSpot?: string;
    foodSpot?: string | null;
    foodLevel?: FoodLevel;
  }) =>
    request<GameState>("/api/debug", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
};
