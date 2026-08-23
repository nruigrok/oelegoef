export interface GameState {
  hunger: number;
  weight: number;
  catSpot: string;
  foodSpot: string | null;
  foodFull: boolean;
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
  getState: () => request<GameState>("/api/state"),

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
    foodFull?: boolean;
  }) =>
    request<GameState>("/api/debug", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
};
