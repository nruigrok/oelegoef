export interface GameState {
  hunger: number;
  weight: number;
  catX: number;
  catY: number;
  foodX: number | null;
  foodY: number | null;
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

  moveCat: (x: number, y: number) =>
    request<GameState>("/api/move-cat", {
      method: "POST",
      body: JSON.stringify({ x, y }),
    }),

  placeFood: (x: number, y: number) =>
    request<GameState>("/api/place-food", {
      method: "POST",
      body: JSON.stringify({ x, y }),
    }),

  feed: () =>
    request<{ fed: boolean; state: GameState }>("/api/feed", {
      method: "POST",
    }),
};
